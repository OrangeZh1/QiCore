import {randomBytes,randomUUID,timingSafeEqual,createHash,createHmac} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fail} from './errors.mjs';
import {maintenanceGrants,ownerGrants} from './standalone-maintenance.mjs';
import {standaloneOwner,enterpriseId,provisionEnterprise,developmentBootstrapAllowed,bindNewOwner} from './standalone-edition.mjs';
import {activeTenantScope,tenantGrantMap} from './tenant-access.mjs';
import {applicationPermissions,applicationGrants} from '#qicore/application-permissions';

const normalizeAccountImage=async (value,options)=>(await import('./account-image.mjs')).normalizeAccountImage(value,options);
const digest=value=>createHash('sha256').update(value).digest('hex');
function cookieName(portal){
  if(portal!=='tenant')return 'qicore_admin_session';
  const workspace=process.env.QICORE_DEV_WORKSPACE;
  if(process.env.NODE_ENV==='development'&&workspace){
    return 'qicore_enterprise_session_'+digest(path.resolve(workspace)).slice(0,24);
  }
  return 'qicore_enterprise_session';
}
const sessionMs=8*3600000;
const auditTenantId=s=>s.role==='root'?'__platform__':s.tenantId||'__account__';
export const allPermissions=['overview.read','tenants.read','tenants.write','accounts.read','accounts.write','roles.read','roles.write','consumers.read','consumers.write','templates.read','templates.write','works.read','jobs.read','entitlements.read','entitlements.write','orders.read','orders.manage','content.read','content.write','settings.read','settings.write','materials.read','materials.write','cache.read','cache.clear','tasks.read','tasks.write','backups.read','backups.create','backups.download','backups.delete','backups.restore','audit.read','services.read','services.update'];
import {passwordHash,passwordMatches,passwordValue,platformPermissions,foundationTenantPermissions} from './admin-identity.mjs';
export {passwordHash,passwordMatches,platformPermissions} from './admin-identity.mjs';
export const tenantPermissions=[...applicationPermissions,...foundationTenantPermissions];
const loadedTenantGrants=new Set([...tenantPermissions,...applicationGrants,...maintenanceGrants]);
// Only the built-in role follows the trusted loaded catalog. Preserve historical
// grants for reinstall; effective permissions still pass through the loaded gate.
export async function ensureTenantAdministratorRole(db){
  let role=await db.adminRole.upsert({where:{systemCode:'tenant-admin'},update:{},create:{id:randomUUID(),name:'管理员',portal:'tenant',permissions:tenantPermissions,systemCode:'tenant-admin'}});
  if(role.portal!=='tenant')fail('ROLE_UNAVAILABLE','管理员角色当前不可用',409);
  await db.$queryRaw`SELECT id FROM AdminRole WHERE id=${role.id} FOR UPDATE`;
  role=await db.adminRole.findUniqueOrThrow({where:{id:role.id}});
  const added=tenantPermissions.filter(permission=>!role.permissions.includes(permission));
  if(added.length){
    role=await db.adminRole.update({where:{id:role.id},data:{permissions:[...role.permissions,...added],version:{increment:1}}});
    const company=await db.tenant.findUnique({where:{standaloneSlot:1},select:{id:true}});
    await db.audit.create({data:{id:randomUUID(),scope:company?'tenant':'platform',tenantId:company?.id??'__platform__',actor:'system',action:'role.application-grants.sync',details:{roleId:role.id,added}}});
  }
  return role;
}
const usernameValue=v=>{if(typeof v!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}$/.test(v))fail('ACCOUNT_INVALID','账号须为 3–32 位字母、数字、点、横线或下划线');return v.toLowerCase()};
export function requestCookie(header,portal='admin'){const name=cookieName(portal),part=(header||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='));return part?part.slice(name.length+1):'';}
export class AdminAuth {
  constructor(db,redis,options={}){this.db=db;this.storage=options.storage||null;this.redis=redis;this.directory=path.resolve(options.directory||process.env.ADMIN_STATE_PATH||'../../.local');this.origin=options.origin||process.env.ADMIN_ORIGIN||'http://127.0.0.1:3500';}
  async bootstrap(){
    await mkdir(this.directory,{recursive:true});const keyFile=path.join(this.directory,'admin-csrf.key');
    try{this.csrfKey=await readFile(keyFile);}catch(e){if(e.code!=='ENOENT')throw e;try{await writeFile(keyFile,randomBytes(32),{flag:'wx',mode:0o600});}catch(w){if(w.code!=='EEXIST')throw w;}this.csrfKey=await readFile(keyFile);}
    if(this.csrfKey.length!==32)throw new Error('后台签名文件异常，原文件已保留');
    if(await this.db.tenant.count()){
      await this.db.$transaction(db=>ensureTenantAdministratorRole(db));return;
    }
    if(!developmentBootstrapAllowed())throw Error('STANDALONE_INSTALLATION_REQUIRED');
    const existingCount=await this.db.adminAccount.count();
    if(existingCount>1)throw Error('STANDALONE_DEV_DATABASE_NOT_EMPTY');
    const file=path.join(this.directory,'admin-bootstrap.json');let credentials;
    try{
      credentials=JSON.parse(await readFile(file,'utf8'));usernameValue(credentials.username);passwordValue(credentials.password);
    }catch(e){
      if(e.code!=='ENOENT'||existingCount)throw Error('开发管理员凭据缺失或不匹配，已保留原数据');
      credentials={username:process.env.ADMIN_BOOTSTRAP_USERNAME||'admin',password:randomBytes(24).toString('base64url')};
      usernameValue(credentials.username);await writeFile(file,JSON.stringify(credentials,null,2)+'\n',{flag:'wx',mode:0o600});
    }
    const username=credentials.username.toLowerCase();
    const encrypted=existingCount?null:await passwordHash(credentials.password);
    await this.db.$transaction(async tx=>{
      if(await tx.tenant.count())return;
      const accounts=await tx.adminAccount.findMany({take:2,include:{role:true,scopes:true}});
      if(!accounts.length&&encrypted){
        await provisionEnterprise(tx,{username,nickname:'管理员',passwordHash:encrypted,permissions:tenantPermissions});return;
      }
      const previous=accounts[0];
      if(accounts.length!==1||!previous.enabled||previous.deletedAt||previous.username!==username||previous.role.systemCode!=='platform-admin'||
        previous.role.portal!=='admin'||previous.scopes.length||!await passwordMatches(credentials.password,previous.passwordHash))throw Error('STANDALONE_DEV_ROOT_NOT_VERIFIED');
      const role=await ensureTenantAdministratorRole(tx);
      await tx.adminSession.deleteMany({where:{adminId:previous.id}});
      await tx.adminAccount.update({where:{id:previous.id},data:{roleId:role.id,nickname:'管理员',version:{increment:1}}});
      await bindNewOwner(tx,previous.id);
    },{isolationLevel:'Serializable'});
  }
  originAllowed(origin){
    if(origin===this.origin)return;
    // Local dev aliases retain the configured protocol/port; production stays exact-origin.
    if(process.env.NODE_ENV==='development'&&(origin===process.env.PUBLIC_ADMIN_ORIGIN&&!!origin||origin===this.origin.replace(/^http:\/\/127\.0\.0\.1(?=:|$)/,'http://localhost')))return;
    fail('ORIGIN_REJECTED','请求来源不允许',403);
  }
  demoEnabled(){return process.env.NODE_ENV==='development'&&process.env.ADMIN_DEMO_LOGIN==='true'&&(process.env.API_HOST||'127.0.0.1')==='127.0.0.1';}
  async demoLogin(input,ip,origin){
    if(!this.demoEnabled()||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip))fail('NOT_FOUND','接口不存在',404);
    this.originAllowed(origin);
    const portal=input?.portal;
    if(!['admin','tenant'].includes(portal))fail('PORTAL_INVALID','后台入口无效',400);
    if(portal==='tenant'&&!await this.db.tenant.count({where:{id:'demo'}}))fail('DEMO_TENANT_UNAVAILABLE','当前没有可进入的演示站点',409);
    // 独立演示身份，不读取初始管理员密码，不接受客户端指定账号或租户。
    const accountId=`dev-demo-${portal}`,systemCode=`dev-demo-${portal}`;
    const role=await this.db.adminRole.upsert({where:{systemCode},update:{},create:{id:systemCode,systemCode,name:portal==='admin'?'平台演示管理员':'租户演示管理员',portal,permissions:portal==='admin'?platformPermissions:tenantPermissions}});
    const account=await this.db.adminAccount.upsert({where:{id:accountId},update:{},create:{id:accountId,username:accountId,nickname:portal==='admin'?'平台演示用户':'租户演示用户',passwordHash:await passwordHash(randomBytes(32).toString('hex')),roleId:role.id,...(portal==='tenant'?{scopes:{create:{tenantId:'demo'}}}:{})},include:{role:true,scopes:{include:{permissionRole:true}}}});
    if(!account.enabled||!account.role.enabled||account.role.portal!==portal||account.role.id!==role.id)fail('FORBIDDEN','演示账号不可用',403);
    if(portal==='tenant'&&(account.scopes.length!==1||account.scopes[0].tenantId!=='demo'))fail('FORBIDDEN','演示账号仅能访问开发测试租户',403);
    return this.issueSession(account,'admin.demo-login');
  }
  async login(input,ip,origin){
    this.originAllowed(origin);const username=usernameValue(input.username),password=input.password;
    if(input.portal!=='tenant'||typeof password!=='string'||password.length>128)fail('LOGIN_INVALID','请输入有效的账号和密码',401);
    const rateKey='qicore:enterprise-login:'+digest(ip+'|'+username);
    if(rateKey){
      const attempts=Number(await this.redis.eval("local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],900) end;return n",1,rateKey));
      if(attempts>10)fail('LOGIN_LIMIT','登录尝试过多，请稍后重试',429);
    }
    const account=await this.db.adminAccount.findUnique({where:{username},include:{role:true,scopes:{include:{permissionRole:true}}}});
    // 未知账号也执行一次同等成本校验，减少时序上的账号枚举。
    const comparison=account?.passwordHash||'scrypt$00000000000000000000000000000000$'+'0'.repeat(128);
    const valid=await passwordMatches(password,comparison);
    if(!valid||!account?.enabled||account.deletedAt||!account.role.enabled)fail('LOGIN_INVALID','账号或密码错误，或账号已停用',401);
    if(account.role.portal!==input.portal)fail('PORTAL_FORBIDDEN','该账号没有当前后台入口权限',403);
    if(account.scopes.length!==1||account.scopes[0].tenantId!==enterpriseId(this.db))fail('SCOPE_EMPTY','账号没有本站的后台权限',403);
    if(input.portal==='tenant'&&!account.scopes.length)fail('SCOPE_EMPTY','账号尚未获得租户授权',403);
    if(input.portal==='tenant')account.scopes=await this.activeScopes(account.scopes);
    if(rateKey)await this.redis.del(rateKey);
    return this.issueSession(account,'admin.login');
  }
  async activeScopes(scopes,status=403){
    scopes=scopes.filter(activeTenantScope);
    const tenants=await this.db.tenant.findMany({where:{id:{in:scopes.map(s=>s.tenantId)}},select:{id:true,enabled:true,expiresAt:true}});
    // Expiry limits site operations, not the account's login and site selector.
    const available=tenants.filter(t=>t.enabled);
    if(!available.length)fail('TENANT_DISABLED','所属租户已停用，请联系平台管理员',status);
    return scopes.filter(scope=>available.some(t=>t.id===scope.tenantId));
  }
  async issueSession(account,action){
    const token=randomBytes(32).toString('hex'),csrfToken=this.csrfToken(token);
    return this.db.$transaction(async tx=>{
      // Serialize concurrent sign-ins with account edits. Single-session mode keeps only the last committed login.
      await tx.$queryRaw`SELECT id FROM AdminRole WHERE id = ${account.roleId} LOCK IN SHARE MODE`;
      await tx.$queryRaw`SELECT id FROM AdminAccount WHERE id = ${account.id} FOR UPDATE`;
      const current=await tx.adminAccount.findUnique({where:{id:account.id},include:{role:true,scopes:{include:{permissionRole:true}}}});
      if(!current?.enabled||current.deletedAt||!current.role.enabled||current.version!==account.version||current.role.version!==account.role.version)fail('LOGIN_CHANGED','账号已更新，请重新登录',401);
      if(!current.allowMultipleSessions)await tx.adminSession.deleteMany({where:{adminId:account.id}});
      if(current.role.portal==='tenant')current.scopes=await this.activeScopes(current.scopes);
      const record=await tx.adminSession.create({data:{tokenHash:digest(token),csrfHash:digest(csrfToken),adminId:current.id,portal:current.role.portal,expiresAt:new Date(Date.now()+sessionMs)}});
      await tx.audit.create({data:{scope:current.role.portal==='admin'?'platform':'tenant',id:randomUUID(),tenantId:auditTenantId(this.view(current)),actor:current.id,action,details:{portal:current.role.portal}}});
      return {info:{...this.view(current),csrfToken,expiresAt:record.expiresAt},cookie:this.sessionCookie(token,sessionMs/1000,'/',current.role.portal)};
    });
  }

  view(account){const scopes=account.scopes.filter(activeTenantScope),permissionsByTenant=account.role.portal==='tenant'?Object.fromEntries(Object.entries(tenantGrantMap({...account,scopes})).map(([id,grants])=>[id,ownerGrants(account.id,standaloneOwner(this.db),grants.filter(grant=>loadedTenantGrants.has(grant)))])):undefined;return {id:account.id,userId:account.id,username:account.username,nickname:account.nickname,avatar:account.avatar||null,profileVersion:account.version,role:account.role.portal==='admin'?'root':'tenant',roleName:account.role.name,tenantIds:scopes.map(s=>s.tenantId),tenantId:account.role.portal==='tenant'&&scopes.length===1?scopes[0].tenantId:null,permissions:permissionsByTenant?[...new Set(Object.values(permissionsByTenant).flat())]:account.role.permissions,...(permissionsByTenant?{permissionsByTenant}:{}),isSuperAdmin:account.role.systemCode==='platform-admin'};}
  csrfToken(raw){return createHmac('sha256',this.csrfKey).update(raw).digest('hex');}
  sessionCookie(raw,maxAge,scope='/',portal='admin'){return cookieName(portal)+'='+raw+'; HttpOnly; SameSite=Lax; Path='+scope+'; Max-Age='+maxAge+(this.origin.startsWith('https:')?'; Secure':'')}
  sessionCookies(header,expiresAt,portal='admin'){const raw=requestCookie(header,portal);return [this.sessionCookie(raw,Math.max(0,Math.floor((new Date(expiresAt).getTime()-Date.now())/1000)),'/',portal),this.sessionCookie('',0,'/api/v1',portal)]}
  publicSession(session){const {tokenHash,csrfHash,_admin,...safe}=session;return safe;}
  async session(cookie,portal){
    portal=portal||(requestCookie(cookie,'admin')?'admin':'tenant');
    const raw=requestCookie(cookie,portal);if(! /^[a-f0-9]{64}$/.test(raw))fail('UNAUTHENTICATED','请登录后台',401);
    const record=await this.db.adminSession.findUnique({where:{tokenHash:digest(raw)},include:{admin:{include:{role:true,scopes:{include:{permissionRole:true}}}}}});
    if(!record||record.portal!==portal||record.expiresAt.getTime()<=Date.now()||!record.admin.enabled||record.admin.deletedAt||!record.admin.role.enabled||record.portal!==record.admin.role.portal)fail('UNAUTHENTICATED','后台会话已失效，请重新登录',401);
    if(record.admin.id.startsWith('dev-demo-')&&!this.demoEnabled())fail('UNAUTHENTICATED','演示登录已关闭',401);
    const view=this.view(record.admin);if(view.role==='tenant'&&!view.tenantIds.length)fail('UNAUTHENTICATED','租户授权已失效',401);
    if(view.role==='tenant'){record.admin.scopes=await this.activeScopes(record.admin.scopes,401);Object.assign(view,this.view(record.admin));}
    return {...view,tokenHash:record.tokenHash,csrfHash:record.csrfHash,csrfToken:this.csrfToken(raw),expiresAt:record.expiresAt,_admin:true};
  }
  assertWrite(session,csrf,origin){this.originAllowed(origin);if(typeof csrf!=='string'||! /^[a-f0-9]{64}$/.test(csrf)||!timingSafeEqual(Buffer.from(digest(csrf),'hex'),Buffer.from(session.csrfHash,'hex')))fail('CSRF_REJECTED','请求校验失败，请刷新后重试',403);}
  authorize(session,permission,tenantId){if(!session._admin||!session.permissions.includes(permission))fail('FORBIDDEN','没有该操作权限',403);if(session.role==='root'&&(!platformPermissions.includes(permission)||tenantId))fail('TENANT_OPERATION','运营数据由租户后台管理',403);if(session.role==='tenant'&&(!tenantId||!session.tenantIds.includes(tenantId)))fail('FORBIDDEN','没有该租户的数据权限',403);}
  async logout(session){await this.db.adminSession.deleteMany({where:{tokenHash:session.tokenHash}});return this.sessionCookie('',0,'/',session.role==='tenant'?'tenant':'admin');}
  delegationCookie(token,maxAge){return `qicore_tenant_delegate=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${this.origin.startsWith('https:')?'; Secure':''}`;}
  hasDelegation(header){return /(?:^|;\s*)qicore_tenant_delegate=/.test(header||'');}
  async startDelegation(parent,tenantId){
    if(!parent._admin||parent.role!=='root'||!parent.permissions.includes('accounts.write')||!parent.permissions.includes('tenants.read'))fail('FORBIDDEN','没有平台代登录权限',403);
    if(typeof tenantId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(tenantId))fail('TENANT_INVALID','租户编号无效');
    const token=randomBytes(32).toString('hex'),expiresAt=new Date(parent.expiresAt);
    return this.db.$transaction(async tx=>{
      const rows=await tx.$queryRaw`SELECT tokenHash FROM AdminSession WHERE tokenHash=${parent.tokenHash} FOR UPDATE`;
      if(!rows.length)fail('UNAUTHENTICATED','平台会话已失效',401);
      const tenant=await tx.tenant.findUnique({where:{id:tenantId}});
      if(!tenant?.enabled)fail('TENANT_UNAVAILABLE','租户已停用',409);
      const account=tenant.ownerAdminId?await tx.adminAccount.findFirst({where:{id:tenant.ownerAdminId,enabled:true,deletedAt:null,role:{portal:'tenant',enabled:true},scopes:{some:{tenantId}}}}):null;
      if(!account)fail('OWNER_UNAVAILABLE','租户没有可用的关联用户',409);
      if(account.id.startsWith('dev-demo-')&&!this.demoEnabled())fail('OWNER_UNAVAILABLE','演示账号仅可在本地开发环境使用',409);
      await tx.adminDelegation.deleteMany({where:{parentTokenHash:parent.tokenHash}});
      await tx.adminDelegation.create({data:{tokenHash:digest(token),parentTokenHash:parent.tokenHash,tenantId,targetAdminId:account.id,expiresAt}});
      await tx.audit.create({data:{scope:'platform',id:randomUUID(),tenantId,actor:parent.id,action:'tenant.impersonation.start',details:{targetAdminId:account.id,expiresAt:expiresAt.toISOString()}}});
      return {cookie:this.delegationCookie(token,Math.max(0,Math.floor((expiresAt.getTime()-Date.now())/1000))),info:{tenantId,targetAdminId:account.id,expiresAt}};
    });
  }
  async delegatedSession(header){
    const parent=await this.session(header,'admin');
    if(parent.role!=='root'||!parent.permissions.includes('accounts.write')||!parent.permissions.includes('tenants.read'))fail('FORBIDDEN','平台代登录权限已失效',403);
    const raw=(header||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('qicore_tenant_delegate='))?.slice('qicore_tenant_delegate='.length);
    if(!raw||!/^[a-f0-9]{64}$/.test(raw))fail('UNAUTHENTICATED','代登录会话不存在',401);
    const record=await this.db.adminDelegation.findUnique({where:{tokenHash:digest(raw)}});
    if(!record||record.parentTokenHash!==parent.tokenHash||record.expiresAt.getTime()<=Date.now())fail('UNAUTHENTICATED','代登录已到期，请从平台重新进入',401);
    const [tenant,account]=await Promise.all([
      this.db.tenant.findUnique({where:{id:record.tenantId}}),
      this.db.adminAccount.findUnique({where:{id:record.targetAdminId},include:{role:true,scopes:{include:{permissionRole:true}}}})
    ]);
    if(!tenant?.enabled||tenant.ownerAdminId!==record.targetAdminId||!account?.enabled||account.deletedAt||account.role.portal!=='tenant'||!account.role.enabled||!account.scopes.some(s=>s.tenantId===tenant.id&&activeTenantScope(s)))fail('UNAUTHENTICATED','租户或关联用户状态已改变，代登录已失效',401);
    if(account.id.startsWith('dev-demo-')&&!this.demoEnabled())fail('UNAUTHENTICATED','演示登录已关闭',401);
    return {...this.view({...account,scopes:account.scopes.filter(scope=>scope.tenantId===tenant.id)}),tokenHash:record.tokenHash,csrfHash:digest(this.csrfToken(raw)),csrfToken:this.csrfToken(raw),expiresAt:record.expiresAt,_admin:true,delegated:true,impersonatedBy:parent.id,delegatedBy:parent.nickname,tenantName:tenant.name};
  }
  async stopDelegation(session){
    await this.db.$transaction(async tx=>{await tx.adminDelegation.deleteMany({where:{tokenHash:session.tokenHash}});await tx.audit.create({data:{scope:'platform',id:randomUUID(),tenantId:session.tenantId,actor:session.impersonatedBy,action:'tenant.impersonation.end',details:{targetAdminId:session.id}}})});
    return this.delegationCookie('',0);
  }
  async updateProfile(session,input){
    if(!session._admin)fail('FORBIDDEN','请登录后台',403);
    if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['nickname','avatar','version'].includes(k)))fail('PROFILE_INVALID','只允许修改本人的头像和昵称');
    const nickname=typeof input.nickname==='string'?input.nickname.trim():'';
    if(!nickname||nickname.length>32||/[\u0000-\u001f\u007f]/.test(nickname))fail('PROFILE_INVALID','昵称须为 1–32 个有效字符');
    if(!Number.isSafeInteger(input.version)||input.version<1)fail('PROFILE_INVALID','资料版本无效，请重新打开编辑窗口');
    let avatar;try{avatar=await normalizeAccountImage(input.avatar,{storage:this.storage})}catch{fail('AVATAR_INVALID','请选择有效的 JPG、PNG 或 WebP 头像')}
    return this.db.$transaction(async db=>{
      const changed=await db.adminAccount.updateMany({where:{id:session.id,enabled:true,version:input.version},data:{nickname,avatar,version:{increment:1}}});
      if(!changed.count)fail('PROFILE_CONFLICT','资料已发生变化，请重新打开编辑窗口',409);
      const account=await db.adminAccount.findUnique({where:{id:session.id},include:{role:true,scopes:{include:{permissionRole:true}}}});
      await db.audit.create({data:{scope:session.role==='root'?'platform':'tenant',id:randomUUID(),tenantId:auditTenantId(session),actor:session.id,action:'admin.profile',details:{fields:['nickname','avatar']}}});
      return this.view(account);
    });
  }
  async changePassword(session,input){
    if(!session?._admin||session.delegated)fail('FORBIDDEN','当前身份不能修改密码',403);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['currentPassword','newPassword'].includes(k))||typeof input.currentPassword!=='string')fail('PASSWORD_INVALID','请输入当前密码和新密码');
    const account=await this.db.adminAccount.findUnique({where:{id:session.id}});
    if(!account?.enabled||account.deletedAt||!await passwordMatches(input.currentPassword,account.passwordHash))fail('PASSWORD_MISMATCH','当前密码校验失败',400);
    const encrypted=await passwordHash(input.newPassword);
    await this.db.$transaction(async db=>{
      if(session.tokenHash&&!await db.adminSession.findFirst({where:{tokenHash:session.tokenHash,adminId:session.id,expiresAt:{gt:new Date()}}}))fail('UNAUTHENTICATED','会话已失效，请重新登录',401);
      const changed=await db.adminAccount.updateMany({where:{id:session.id,version:account.version,passwordHash:account.passwordHash,enabled:true,deletedAt:null,role:{enabled:true,portal:session.role==='root'?'admin':'tenant'}},data:{passwordHash:encrypted,version:{increment:1}}});
      if(!changed.count)fail('PASSWORD_CONFLICT','账号已变更，请重新登录后再修改密码',409);
      await db.adminSession.deleteMany({where:{adminId:session.id}});await db.adminDelegation.deleteMany({where:{targetAdminId:session.id}});await db.audit.create({data:{scope:session.role==='root'?'platform':'tenant',id:randomUUID(),tenantId:auditTenantId(session),actor:session.id,action:'admin.password',details:{sessionsRevoked:true}}});
    });
    return {updated:true,reauthenticate:true};
  }
}
