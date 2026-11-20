import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {createLiveInstall} from '../app/utils/install-live.ts';

function setup(t,state={available:true,complete:false,authenticated:true,csrf:'fixture'}){
 const requests=[];const wizard=createLiveInstall(state,(path,options)=>new Promise((resolve,reject)=>requests.push({path,options,resolve,reject})),signal=>new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true})));
 t.after(wizard.dispose);return {wizard,requests};
}
test('live installation owns delayed indicators, cancels edited database checks and accepts only server completion',async t=>{
 const {wizard:w,requests:r}=setup(t);const auth=w.checkAuthorization();assert.equal(w.checkingAuthorization.value,true);assert.equal(w.checkingEnvironment.value,false);r[0].resolve({state:'active',allowed:true,domain:'example.com',source:'verified-online-receipt'});await auth;
 w.accepted.value=true;w.next();assert.equal(w.step.value,1);const environment=w.inspectEnvironment();assert.equal(w.checkingEnvironment.value,true);assert.equal(w.checkingAuthorization.value,false);r[1].resolve({passed:true,checks:[{key:'runtime',label:'运行环境',passed:true}]});await environment;w.next();assert.equal(w.step.value,2);
 Object.assign(w.form,{databaseUsername:'fixture',databasePassword:'secret'});const stale=w.testConnections();assert.equal(w.checkingConnections.value,true);assert.equal(w.checkingEnvironment.value,false);w.form.database='changed';assert.equal(r[2].options.signal.aborted,true);r[2].resolve({passed:true});await stale;assert.equal(w.connections.value,'idle');
 const connection=w.testConnections();r[3].resolve({passed:true});await connection;w.next();Object.assign(w.form,{password:'123456',confirmPassword:'123456'});w.next();assert.equal(w.step.value,4);
 const install=w.simulateInstallation();assert.equal(w.installing.value,true);assert.equal(w.checkingConnections.value,false);assert.equal(r[4].path,'/execute');assert.equal(r[4].options.body.administrator.password,'123456');r[4].resolve({accepted:true,taskId:'fixture'});await install;assert.equal(w.form.password,'');assert.equal(w.form.databasePassword,'');
 r[5].resolve({id:'fixture',status:'succeeded',phase:'completion',complete:true,code:null,message:null});await setImmediate();assert.equal(w.step.value,5);assert.equal(w.progress.value,100);assert.equal(w.installing.value,false);
});
test('installation access, server recovery and leaving keep secrets and action states separate',async t=>{
 const {wizard:w,requests:r}=setup(t,{available:true,complete:false,authenticated:false});const login=w.resume('fixture-token');assert.equal(w.accessBusy.value,true);assert.equal(w.checkingAuthorization.value,false);assert.deepEqual(r[0].options.body,{token:'fixture-token'});r[0].resolve({csrf:'fixture-csrf',job:{status:'idle'}});await login;assert.equal(w.accessBusy.value,false);assert.equal(w.checkingAuthorization.value,true);assert.equal(r[1].options.headers['x-install-csrf'],'fixture-csrf');r[1].reject({data:{error:{message:'授权连接失败'}}});await setImmediate();assert.equal(w.authorizationAllowed.value,false);assert.equal(w.checkingAuthorization.value,false);
 const {wizard:recover}=setup(t,{available:true,complete:false,authenticated:true,csrf:'fixture',job:{id:'job',status:'recovery_required',phase:'migration',code:'INSTALLATION_INTERRUPTED',message:'安装中断',complete:false}});assert.equal(recover.recoveryRequired.value,true);assert.equal(recover.step.value,4);assert.equal(recover.phases.value[2],'failed');assert.equal(recover.progress.value<100,true);
 const deferred=w.inspectEnvironment();w.form.password='sensitive';w.dispose();assert.equal(r[2].options.signal.aborted,true);r[2].resolve({passed:true,checks:[]});await deferred;assert.equal(w.environment.value,'idle');assert.equal(w.form.password,'');assert.equal(w.checkingEnvironment.value,false);
});

test('opening the domain checks entitlement automatically without granting installation access',async t=>{
 const {wizard:w,requests:r}=setup(t,{available:true,complete:false,authenticated:false});await w.resume();assert.equal(r[0].path,'/authorization');assert.equal(r[0].options.method,'GET');assert.equal(w.checkingAuthorization.value,true);assert.equal(w.accessBusy.value,false);
 r[0].resolve({state:'active',allowed:true,domain:'example.com',source:'verified-online-receipt'});await setImmediate();assert.equal(w.authorizationAllowed.value,true);assert.equal(w.authenticated.value,false);w.accepted.value=true;w.next();assert.equal(w.step.value,0);await w.inspectEnvironment();assert.equal(r.length,1);
 const login=w.resume('expired-link');r[1].reject({data:{error:{message:'安装链接已失效'}}});await login;assert.equal(w.accessError.value,'安装链接已失效');assert.equal(w.accessBusy.value,false);assert.equal(w.authenticated.value,false);r[2].resolve({state:'unlicensed',allowed:false});await setImmediate();assert.equal(w.checkingAuthorization.value,false);
});

test('opening a launch link cancels an unfinished public check without losing the link',async t=>{
 const {wizard:w,requests:r}=setup(t,{available:true,complete:false,authenticated:false});await w.resume();const login=w.resume('fixture-link');assert.equal(r[0].options.signal.aborted,true);assert.equal(w.checkingAuthorization.value,false);assert.equal(w.accessBusy.value,true);
 r[0].resolve({state:'unlicensed',allowed:false});r[1].resolve({csrf:'session-csrf',job:{status:'idle'}});await login;assert.equal(w.authenticated.value,true);assert.equal(w.accessBusy.value,false);assert.equal(w.checkingAuthorization.value,true);r[2].resolve({state:'active',allowed:true});await setImmediate();assert.equal(w.authorizationAllowed.value,true);assert.equal(w.checkingAuthorization.value,false);
});

test('Redis checks discard edited responses, preserve saved passwords and clear newly entered secrets',async t=>{
 const view={host:'cache.local',port:6379,database:1,username:'',tls:false,hasPassword:true}, {wizard:w,requests:r}=setup(t,{available:true,complete:false,authenticated:true,csrf:'fixture',redis:view});
 const first=w.inspectEnvironment();assert.equal(w.checkingEnvironment.value,true);assert.equal(w.checkingConnections.value,false);assert.equal('password' in r[0].options.body.redis,false);
 w.redis.host='changed.local';assert.equal(r[0].options.signal.aborted,true);assert.equal(w.checkingEnvironment.value,false);r[0].resolve({passed:true,checks:[],redis:view});await first;assert.equal(w.environment.value,'idle');assert.equal(w.redis.host,'changed.local');
 w.redis.keepPassword=false;w.redis.password='new-secret';const failed=w.inspectEnvironment();r[1].reject(Error('连接未通过'));await failed;assert.equal(w.checkingEnvironment.value,false);assert.equal(w.environment.value,'failed');assert.equal(w.redis.password,'new-secret');
 const success=w.inspectEnvironment();assert.equal(r[2].options.body.redis.password,'new-secret');r[2].resolve({passed:true,checks:[],redis:{...view,host:'changed.local'}});await success;assert.equal(w.environment.value,'passed');assert.equal(w.checkingEnvironment.value,false);assert.equal(w.redis.password,'');assert.equal(w.redis.keepPassword,true);
 w.redis.keepPassword=false;w.redis.password='temporary';const pending=w.inspectEnvironment();w.dispose();assert.equal(w.redis.password,'');r[3].resolve({passed:true,checks:[],redis:view});await pending;assert.equal(w.checkingEnvironment.value,false);assert.equal(w.redis.host,'changed.local');
});

test('health recovery submits only the existing task and keeps delayed, failed and cancelled indicators separate',async t=>{
 const job={id:'existing-task',status:'recovery_required',phase:'health',code:'RUNTIME_EXITED',message:'服务启动失败',complete:false,canResume:true};
 const {wizard:w,requests:r}=setup(t,{available:true,complete:false,authenticated:true,csrf:'fixture',job});
 assert.equal(w.progress.value,67);const retry=w.retryInstallation();assert.equal(w.resuming.value,true);assert.equal(w.checkingAuthorization.value,false);assert.equal(w.checkingEnvironment.value,false);assert.deepEqual(r[0].options.body,{requestId:job.id});assert.equal(r[0].path,'/resume-health');
 await w.retryInstallation();assert.equal(r.length,1);r[0].reject(Error('服务暂不可用'));await retry;assert.equal(w.resuming.value,false);assert.equal(w.canResume.value,true);
 const next=w.retryInstallation();r[1].resolve({accepted:true,taskId:job.id});await next;assert.equal(w.resuming.value,true);r[2].resolve({...job,status:'succeeded',phase:'completion',complete:true,canResume:false,message:null});await setImmediate();assert.equal(w.resuming.value,false);assert.equal(w.step.value,5);assert.equal(w.progress.value,100);
 const {wizard:cancel,requests:c}=setup(t,{available:true,complete:false,authenticated:true,csrf:'fixture',job});const pending=cancel.retryInstallation();cancel.dispose();assert.equal(c[0].options.signal.aborted,true);c[0].resolve({accepted:true});await pending;assert.equal(cancel.resuming.value,false);assert.equal(c.length,1);
 const {wizard:blocked,requests:b}=setup(t,{available:true,complete:false,authenticated:true,csrf:'fixture',job:{...job,phase:'migration',canResume:false}});await blocked.retryInstallation();assert.equal(b.length,0);
});

test('refreshing recovery checks entitlement through the read-only endpoint without submitting recovery',async t=>{
 const {wizard:w,requests:r}=setup(t,{available:true,complete:false,authenticated:true,csrf:'fixture',job:{id:'existing',status:'recovery_required',phase:'health',code:'HEALTH_CHECK_FAILED',message:'服务检查失败',complete:false,canResume:true}});
 await w.resume();assert.equal(r.length,1);assert.equal(r[0].path,'/authorization');assert.equal(r[0].options.method,'GET');assert.equal(w.checkingAuthorization.value,true);assert.equal(w.resuming.value,false);
 r[0].resolve({state:'active',allowed:true,domain:'customer.example',source:'verified-online-receipt'});await setImmediate();assert.equal(w.authorizationAllowed.value,true);assert.equal(w.checkingAuthorization.value,false);assert.equal(w.progress.value,67);
});

test('an early server failure stays visible and retry routes cleared credentials back to their fields',async t=>{
 const {wizard:w,requests:r}=setup(t);
 const auth=w.checkAuthorization();r[0].resolve({state:'active',allowed:true});await auth;
 w.accepted.value=true;Object.assign(w.form,{databaseUsername:'fixture',databasePassword:'fixture-only',password:'123456',confirmPassword:'123456'});
 const install=w.simulateInstallation();const id=r[1].options.body.requestId;r[1].resolve({accepted:true,taskId:id});await install;
 r[2].resolve({id,status:'failed',phase:'start',code:'INSTALL_ARCHIVE_MISSING',message:'配置中的安装包不存在，请检查旧配置',complete:false});await setImmediate();
 assert.equal(w.installationError.value,'配置中的安装包不存在，请检查旧配置');assert.equal(w.form.databasePassword,'');assert.equal(w.form.password,'');assert.equal(w.installing.value,false);
 await w.simulateInstallation();assert.equal(r.length,3);assert.equal(w.step.value,2);assert.equal(w.errors.value.databasePassword,'请输入数据库密码');assert.match(w.notice.value,/密码已清空/);assert.match(w.installationError.value,/安装包不存在/);
});

test('refreshing a failed installation guides back through terms instead of silently ignoring the start button',async t=>{
 const {wizard:w,requests:r}=setup(t,{available:true,complete:false,authenticated:true,csrf:'fixture',job:{id:'failed',status:'failed',phase:'start',code:'INSTALL_ARCHIVE_MISSING',message:'安装包不存在',complete:false}});
 const auth=w.checkAuthorization();r[0].resolve({state:'active',allowed:true});await auth;
 await w.simulateInstallation();assert.equal(w.step.value,0);assert.match(w.notice.value,/安装须知/);assert.equal(w.installationError.value,'安装包不存在');assert.equal(r.length,1);
});

test('delayed environment checks retain safe server path details and keep unrelated indicators idle',async t=>{
 const {wizard:w,requests:r}=setup(t);const pending=w.inspectEnvironment();assert.equal(w.checkingEnvironment.value,true);assert.equal(w.checkingConnections.value,false);assert.equal(w.checkingAuthorization.value,false);
 const checks=[{key:'paths',label:'安装目录',passed:false,message:'代码目录不存在：/opt/customer/code'},{key:'archive',label:'安装文件',passed:false,message:'配置中的安装包不存在：/opt/customer/incoming/qicore-0.1.4-linux-x64.zip'}];
 r[0].resolve({passed:false,checks});await pending;assert.deepEqual(w.environmentChecks.value,checks);assert.equal(w.checkingEnvironment.value,false);assert.equal(w.environment.value,'failed');
});
