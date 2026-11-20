import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {fail,Fault} from '../core/errors.mjs';
import {identityAad,wechatSessionAad} from '../core/wechat-consumer-auth.mjs';
import {miniProgramDomains} from '../channels/mini-domains.mjs';
import {validatePaymentKeys,paymentConfigured} from './config.mjs';
import {WechatTransport} from './wechat-transport.mjs';
import {isXmlNotice,v2Acknowledgement} from './wechat-v2.mjs';
import {logFailure} from '../core/diagnostics.mjs';
import {isIP} from 'node:net';
import {BalancePayments} from './balance.mjs';
import {AlipayPayments} from './alipay.mjs';
import {VirtualPayments} from './virtual.mjs';
import {PaymentClientPolicy} from './client-policy.mjs';
import {assertPaymentClient} from './product-policy.mjs';
import {isH5PlatformHost} from '../core/h5-entry.mjs';
import {h5PagePath} from '../core/h5-routes.mjs';

const hash=v=>createHash('sha256').update(v).digest('hex');
const id=()=>randomUUID().replaceAll('-','');
const scope=p=>({tenantId:p.tenantId,applicationKey:p.applicationKey});
const payerAad=p=>['payment-payer',p.tenantId,p.applicationKey,p.id].join(':');
const noticeAad=(p,n)=>['payment-notice',p.tenantId,p.applicationKey,p.id,n.id].join(':');
const terminal=p=>['PAID','PARTIAL_REFUND','COMPENSATION','REFUNDED','CLOSED','REVIEW'].includes(p.state);
const code=e=>/^[A-Z0-9_]{1,64}$/.test(e?.code||'')?e.code:'PAYMENT_UNCONFIRMED';
const key=v=>{if(typeof v!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(v))fail('PAYMENT_INPUT_INVALID','订单标识无效');return v};
const mismatch=()=>fail('PAYMENT_RECEIPT_MISMATCH','支付凭证与原订单不匹配',409);
const when=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const cents=v=>Number.isSafeInteger(v)&&v>=0;

export class PaymentExecution {
  constructor(db,settings,applications,{gateway=new WechatTransport(),alipayGateway=undefined,virtualGateway=undefined,enabled=process.env.PAYMENT_EXECUTION_ENABLED==='true',origin=()=>process.env.PUBLIC_API_ORIGIN,h5=/** @type {any} */(null)}={}) {
    this.db=db;this.settings=settings;this.secrets=settings.secrets;this.applications=applications;this.gateway=gateway;this.enabled=enabled;this.origin=origin;this.h5=h5;this.busy=false;this.balance=new BalancePayments(this);this.alipay=new AlipayPayments(this,alipayGateway);this.virtual=new VirtualPayments(this,virtualGateway);this.clientPolicy=new PaymentClientPolicy(db);
  }
  app(key){const app=this.applications[key];if(!app)fail('PAYMENT_APPLICATION_INVALID','应用未接入支付',400);return app}
  async refundSummary(db,p,provided){const rows=provided||await db.paymentRefund.findMany({where:{paymentId:p.id},orderBy:{sequence:'desc'}}),succeeded=rows.filter(r=>r.state==='SUCCESS'),refunded=succeeded.reduce((n,r)=>n+(r.amount??p.amount),0),payerRefunded=succeeded.reduce((n,r)=>n+(r.payerRefund||0),0);if(refunded>p.amount||payerRefunded>(p.payerTotal??p.amount))fail('REFUND_LEDGER_MISMATCH','退款累计金额需要人工核查',409);return{rows,refunded,payerRefunded,remaining:p.amount-refunded,busy:rows.some(r=>['APPLIED','PENDING','PROCESSING','ABNORMAL'].includes(r.state))||rows[0]?.state==='CLOSED'}}
  latestRefund(db,paymentId){return db.paymentRefund.findFirst({where:{paymentId},orderBy:{sequence:'desc'}})}
  tx(fn){return this.settings.apps.transaction(fn)}
  assertEnabled(){if(!this.enabled)fail('PAYMENT_INTEGRATION_BLOCKED','平台尚未启用支付执行，请联系平台管理员',503)}
  urls(p){const domains=miniProgramDomains(this.origin());if(!domains.available)fail('PAYMENT_ORIGIN_INVALID','支付通知需要服务端公网 HTTPS 地址',503);const base=domains.request+'/api/v1/payments/wechat/'+p.id;return{notify:base+'/notify',refund:base+'/refund-notify'}}
  async credentials(p,db=this.db) {
    if(p.provider==='alipay')return this.alipay.credentials(p,db);
    if(p.provider==='wechat-virtual')return this.virtual.credentials(p,db);
    const original=await db.tenantPaymentRevision.findFirst({where:{id:p.revisionId,...scope(p),provider:'wechat'}});
    if(!original)mismatch();
    const rows=await db.tenantPaymentRevision.findMany({where:{...scope(p),provider:'wechat'},orderBy:{version:'desc'}});
    const compatible=rows.filter(r=>r.config.mchId===original.config.mchId&&r.config.appId===original.config.appId&&r.config.apiVersion===original.config.apiVersion);
    const trusted=compatible.map(row=>({...row.config,...this.settings.decrypt(row),revisionId:row.id}));
    // Disabling new sales must not strand an existing payment or refund. Retained keys are durable evidence.
    const current=trusted.find(c=>{try{validatePaymentKeys('wechat',c,c,true);return true}catch{return false}});
    if(!current)fail('PAYMENT_KEYS_UNAVAILABLE','原订单商户凭据不可用',503);
    const appId=this.payerData(p).appId||current.appId;return {...current,appId,trusted:trusted.map(config=>({...config,appId}))};
  }
  payerData(p){try{return this.secrets.decrypt(payerAad(p),p.payerCipher)}catch{fail('PAYMENT_IDENTITY_UNAVAILABLE','支付身份无法读取',503)}}
  payer(p){return this.payerData(p).openId}
  async balanceClient(s,context={}){
    let origin;try{if(context.origin){const u=new URL(context.origin);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error();origin=u}}catch{fail('PAYMENT_CLIENT_UNVERIFIED','支付入口无法核验，请从当前站点重新进入',400)}
    if(s.authProvider==='wechat'&&(!origin||origin.hostname==='servicewechat.com'))return'mini';
    if(origin){if(!this.h5||origin.protocol!=='https:'&&process.env.NODE_ENV==='production')fail('PAYMENT_CLIENT_UNVERIFIED','支付入口无法核验',400);await this.h5.resolve({host:origin.host,tenantId:s.tenantId,applicationKey:s.applicationKey});return /MicroMessenger/i.test(context.userAgent||'')||!context.userAgent&&s.authProvider==='wechat-official'?'official':'h5'}
    if(s.authProvider==='wechat-official')return'official';
    fail('PAYMENT_CLIENT_UNVERIFIED','支付入口无法核验，请从当前站点重新进入',400);
  }
  h5Redirect(value,returnUrl){let url;try{url=new URL(value)}catch{fail('PAYMENT_RESPONSE_INVALID','支付地址未确认',503)}if(url.protocol!=='https:'||url.hostname!=='wx.tenpay.com'||url.username||url.password||url.port)fail('PAYMENT_RESPONSE_INVALID','支付地址未确认',503);url.searchParams.set('redirect_url',returnUrl);return url.href}
  async h5Context(s,context){assertPaymentClient(s,'h5');let origin;try{const url=new URL(context.origin);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error();origin=url.origin}catch{fail('PAYMENT_ORIGIN_INVALID','H5 支付需要有效的 HTTPS 站点入口',400)}const ip=String(context.ip||'').replace(/^::ffff:/,'');if(!isIP(ip)||!this.h5)fail('PAYMENT_INPUT_INVALID','H5 支付环境无效');const host=new URL(origin).host;await this.h5.resolve({host,tenantId:s.tenantId,applicationKey:s.applicationKey});return{ip,origin,returnUrl:origin+(isH5PlatformHost(host)?'/h5/'+encodeURIComponent(s.tenantId):'')+h5PagePath('/pages/orders/index')+'?application='+encodeURIComponent(s.applicationKey)}}
  async locked(db,p) {
    const order=await this.app(p.applicationKey).lock(db,p.tenantId,p.orderId);
    await db.$queryRaw`SELECT id FROM PaymentRecord WHERE id=${p.id} FOR UPDATE`;
    const current=await db.paymentRecord.findUnique({where:{id:p.id}});
    if(!current||order.userId!==current.userId||order.amount!==current.amount||order.currency!==current.currency)mismatch();
    return {p:current,order};
  }
  view(p,refund=null){return{orderId:p.orderId,paymentId:p.id,sequence:p.sequence,previousPaymentId:p.previousId,provider:p.provider,state:p.state,paidAt:p.paidAt,payerTotalCents:p.payerTotal,closeRequested:p.closeRequested,closeReason:p.closeReason,lastError:p.lastError,refund:refund?{id:refund.id,state:refund.state,requestedCents:refund.amount??p.amount,payerRefundCents:refund.payerRefund,succeededAt:refund.succeededAt,lastError:refund.lastError}:null}}
  // Caller holds the business-order lock. Retirement and successor creation share
  // the same transaction, including balance debit and application fulfilment.
  async attempt(db,s,orderId,provider,mode,switchFrom=null){
    const p=await db.paymentRecord.findFirst({where:{...scope(s),orderId,currentSlot:1}});
    if(switchFrom){
      if(!p)fail('PAYMENT_SWITCH_CONFLICT','支付记录已变化，请刷新原订单',409);
      if(p.id!==switchFrom){
        if(p.previousId!==switchFrom||p.provider!==provider||this.payerData(p).mode!==mode)fail('PAYMENT_SWITCH_CONFLICT','支付方式已变化，请刷新原订单',409);
        return{p,lineage:{}};
      }
      if(p.state!=='CLOSED'||p.paidAt||p.closeReason!=='switch')fail('PAYMENT_SWITCH_UNCONFIRMED','原支付尚未确认关闭，请查询原订单',409);
      if(p.leaseUntil&&p.leaseUntil>new Date())fail('PAYMENT_BUSY','原支付仍在处理中，请稍后查询',409);
      if(await db.paymentNotice.count({where:{paymentId:p.id,state:'PENDING'}}))fail('PAYMENT_NOTICE_PENDING','原支付有通知待核验，请稍后查询',409);
      await db.paymentRecord.update({where:{id:p.id},data:{currentSlot:null,supersededAt:new Date()}});
      await db.audit.create({data:{id:randomUUID(),scope:'tenant',...scope(s),actor:'consumer',action:'payment.switch',details:{orderId,previousPaymentId:p.id,sequence:p.sequence+1,provider,mode}}});
      return{p:null,lineage:{sequence:p.sequence+1,previousId:p.id}};
    }
    if(p&&p.provider!==provider)fail('PAYMENT_CHANNEL_LOCKED','请先确认原支付关闭后再切换支付方式',409);
    return{p,lineage:{}};
  }
  async switchPayment(s,orderId,input,context={}){
    key(orderId);const parsed=z.object({paymentId:z.string().regex(/^[a-f0-9]{32}$/),provider:z.enum(['wechat','alipay','balance','wechat-virtual']),channel:z.literal('h5').optional()}).strict().refine(v=>v.provider==='alipay'?v.channel==='h5':['balance','wechat-virtual'].includes(v.provider)?!v.channel:true).safeParse(input);
    if(!parsed.success)fail('PAYMENT_INPUT_INVALID','请提供原支付编号和目标支付方式');
    const q=parsed.data,mode=q.provider==='balance'?'BALANCE':q.provider==='alipay'?'ALIPAY_WAP':q.provider==='wechat-virtual'?'VIRTUAL_GOODS':q.channel==='h5'?'MWEB':'JSAPI';
    this.assertEnabled();
    if(q.channel==='h5'){if(/MicroMessenger/i.test(context.userAgent||''))fail('PAYMENT_CLIENT_UNSUPPORTED','微信内请使用公众号微信支付',409);await this.h5Context(s,context)}
    const client=q.provider==='balance'?await this.balanceClient(s,context):q.channel==='h5'?'h5':s.authProvider==='wechat-official'?'official':'mini';
    const before=await this.tx(async db=>{
      const app=this.app(s.applicationKey);await app.authorize(db,s);const order=await app.lock(db,s.tenantId,orderId);
      if(order.userId!==s.userId||order.consumerDeletedAt)fail('NOT_FOUND','订单不存在',404);
      const p=await this.owned(s,orderId,db);
      if(p.id!==q.paymentId){if(p.previousId!==q.paymentId||p.provider!==q.provider||this.payerData(p).mode!==mode)fail('PAYMENT_SWITCH_CONFLICT','支付方式已变化，请刷新原订单',409);return{replay:true,p}}
      if(p.paidAt)return{settled:true,p};
      if(p.provider==='balance'||p.state==='REVIEW'||p.closeRequested&&p.closeReason!=='switch'||p.state==='CLOSED'&&p.closeReason!=='switch')fail('PAYMENT_SWITCH_NOT_ALLOWED','当前支付不能切换，请查询原订单',409);
      await app.payable(db,order);await this.clientPolicy.allowed(db,s,client,q.provider);
      await this.clientPolicy.product(db,s,client,q.provider,app,order);
      if(q.provider==='balance'){
        await app.balancePayable?.(db,order);const account=await this.balance.wallet.account(db,s,'balance');
        if((account?.amount||0n)<BigInt(order.amount))fail('WALLET_INSUFFICIENT','可用余额不足',409);
      }else{
        const rows=await db.tenantPaymentRevision.findMany({where:scope(s),orderBy:{version:'desc'}}),ready=await this.clientPolicy.status(db,s,client,q.provider,rows);
        if(!ready.configured)fail('PAYMENT_UNAVAILABLE',ready.reason,503);
        const row=rows.find(r=>r.provider===q.provider);validatePaymentKeys(q.provider,row.config,this.settings.decrypt(row),true);
        if(q.provider==='wechat-virtual'){if(s.authProvider!=='wechat'||s.authAppId!==row.config.appId||!(await db.session.findUnique({where:{token:s.token}}))?.wechatSessionCipher)fail('WECHAT_SESSION_REFRESH_REQUIRED','请重新进行当前小程序微信登录',401);await this.virtual.goods(db,s,order,row.config)}
        if(mode==='JSAPI'){
          const appId=client==='official'?(await db.tenantOfficialAccountSetting.findUnique({where:{tenantId_applicationKey:scope(s)}}))?.config.appId:row.config.appId;
          if(s.authProvider!==(client==='official'?'wechat-official':'wechat')||s.authAppId!==appId||await db.consumerExternalIdentity.count({where:{...scope(s),userId:s.userId,provider:s.authProvider,appId}})!==1)fail('WECHAT_LOGIN_REQUIRED','请先完成当前渠道的微信身份授权',401);
        }
      }
      if(p.state!=='CLOSED')await db.paymentRecord.update({where:{id:p.id},data:{closeRequested:true,closeReason:'switch',nextCheckAt:new Date()}});
      return{p};
    });
    if(before.settled)return{...await this.status(s,orderId),switchStatus:'settled'};
    if(!before.replay){
      await this.reconcile(before.p.id);
      const current=await this.tx(db=>this.owned(s,orderId,db));
      if(current.id===q.paymentId){
        if(current.paidAt)return{...await this.status(s,orderId),switchStatus:'settled'};
        if(current.state!=='CLOSED')return{...this.view(current),switchStatus:'waiting'};
      }
    }
    const payInput=q.provider==='wechat'?(q.channel?{channel:q.channel}:{}):{provider:q.provider,...(q.channel?{channel:q.channel}:{})};
    const result=await this.pay(s,orderId,payInput,context,q.paymentId);
    return{...result,switchStatus:'completed'};
  }
  async closed(db,p,token){
    const current=await this.locked(db,p);
    if(!current.p.paidAt&&current.p.leaseToken===token){
      if(current.p.currentSlot===1&&current.p.closeReason!=='switch')await this.app(p.applicationKey).cancel(db,current.order);
      await db.paymentRecord.update({where:{id:p.id},data:{state:'CLOSED',lastError:null}});
    }
  }
  async history(db,s,orderId,rows=null){
    // List callers may supply attempts already read in the same scoped transaction.
    rows??=await db.paymentRecord.findMany({where:{...scope(s),userId:s.userId,orderId},orderBy:{sequence:'desc'},include:{refunds:{orderBy:{sequence:'desc'}}}});
    return rows.map(p=>({...this.view(p,p.refunds[0]),current:p.currentSlot===1,createdAt:p.createdAt,supersededAt:p.supersededAt,refundedCents:p.refunds.filter(r=>r.state==='SUCCESS').reduce((n,r)=>n+(r.payerRefund||0),0)}));
  }
  async pendingPaymentReason(db,s,client,p){
    if(p.provider==='wechat'&&p.expiresAt.getTime()-Date.now()<60000)return'支付已关闭或即将到期，请查询原订单';
    const config=await this.credentials(p,db),saved=this.payerData(p);
    if(p.provider==='wechat'){
      if((saved.mode||'JSAPI')!==(client==='h5'?'MWEB':'JSAPI'))return'请使用原支付方式继续支付或查询原订单';
      if(client!=='h5'&&(s.authProvider!==(client==='official'?'wechat-official':'wechat')||s.authAppId!==config.appId))return'请使用原微信身份重新登录';
    }else{
      if(s.authProvider!=='wechat')return'请重新进行当前小程序微信登录';
      const session=await db.session.findUnique({where:{token:s.token}});if(!session?.wechatSessionCipher||session.authAppId!==s.authAppId)return'请重新进行当前小程序微信登录';
      let identity;try{identity=this.secrets.decrypt(wechatSessionAad(session),session.wechatSessionCipher)}catch{fail('PAYMENT_IDENTITY_UNAVAILABLE','支付身份无法读取',503)}
      const external=await db.consumerExternalIdentity.findMany({where:{...scope(s),userId:s.userId,provider:'wechat',appId:s.authAppId}});
      if(external.length!==1||this.secrets.decrypt(identityAad(external[0]),external[0].identityCipher).openId!==identity.openId||saved.openId!==identity.openId||saved.appId!==s.authAppId)mismatch();
    }
    return null;
  }
  async methods(s,orderId,input={}){
    key(orderId);const parsed=z.object({client:z.enum(['mini','official','h5']).default('h5')}).strict().safeParse(input);if(!parsed.success)fail('PAYMENT_INPUT_INVALID','支付端参数无效');const client=parsed.data.client;
    assertPaymentClient(s,client);
    return this.tx(async db=>{
      const app=this.app(s.applicationKey);await app.authorize(db,s);const order=await app.lock(db,s.tenantId,orderId);if(order.userId!==s.userId||order.consumerDeletedAt)fail('NOT_FOUND','订单不存在',404);
      const policy=await this.clientPolicy.read(db,s),p=await db.paymentRecord.findFirst({where:{...scope(s),orderId,userId:s.userId,currentSlot:1}}),rows=await db.tenantPaymentRevision.findMany({where:scope(s),orderBy:{version:'desc'}}),balance=await this.balance.wallet.account(db,s,'balance');
      let orderReason=null,balanceReason=null;try{await app.payable(db,order)}catch(e){if(!(e instanceof Fault))throw e;orderReason=e.message}
      try{await app.balancePayable?.(db,order)}catch(e){if(!(e instanceof Fault))throw e;balanceReason=e}
      const methods=[];
      for(const {provider,enabled} of policy.config[client]){
        if(!enabled||provider==='balance'&&balanceReason?.code==='BALANCE_SELF_RECHARGE')continue;
        const config=rows.find(r=>r.provider===provider);let reason=orderReason;
        const requiresSwitch=!!p&&(p.provider!==provider||p.closeReason==='switch'||provider==='wechat'&&((this.payerData(p).mode||'JSAPI')!==(client==='h5'?'MWEB':'JSAPI')||client!=='h5'&&this.payerData(p).appId!==s.authAppId));
        const resuming=!!p&&p.provider===provider&&['wechat','wechat-virtual'].includes(provider)&&!requiresSwitch&&!p.paidAt&&!terminal(p)&&!p.closeRequested;
        if(client==='mini'&&['wechat','wechat-virtual'].includes(provider)&&!resuming){
          try{await this.clientPolicy.product(db,s,client,provider,app,order)}catch(e){if(!(e instanceof Fault))throw e;if(e.code==='PAYMENT_PRODUCT_UNSUPPORTED')continue;reason||=e.message}
        }
        if(!reason&&p&&(p.paidAt||terminal(p)&&p.state!=='CLOSED'||p.state==='CLOSED'&&p.closeReason!=='switch'||p.closeRequested&&p.closeReason!=='switch'))reason='当前支付不能切换，请查询原订单';
        if(!reason&&requiresSwitch&&!this.enabled)reason='支付执行尚未开放，待渠道联调';
        if(!reason&&provider==='balance')reason=balanceReason?.message||(order.currency!=='CNY'?'余额仅支持人民币订单':(balance?.amount||0n)<BigInt(order.amount)?'可用余额不足':null);
        if(!reason&&provider!=='balance'){
          if(!this.enabled)reason='支付执行尚未开放，待渠道联调';
          else if(resuming){try{reason=await this.pendingPaymentReason(db,s,client,p)}catch(e){if(!(e instanceof Fault))throw e;reason=e.message}}
          else{
            const readiness=await this.clientPolicy.status(db,s,client,provider,rows);
            if(!readiness.configured)reason=readiness.reason;
            else if(provider==='wechat-virtual'){if(s.authProvider!=='wechat'||s.authAppId!==config?.config.appId||!(await db.session.findUnique({where:{token:s.token}}))?.wechatSessionCipher)reason='请重新进行当前小程序微信登录';else try{await this.virtual.goods(db,s,order,config.config)}catch(err){if(!(err instanceof Fault))throw err;reason=err.message}}
            else if(provider==='wechat'&&client==='mini'&&(s.authProvider!=='wechat'||s.authAppId!==config.config.appId))reason='请使用当前小程序的微信身份重新登录';
            else if(provider==='wechat'&&client==='official'&&s.authProvider!=='wechat-official')reason='请先完成公众号身份授权';
          }
        }
        methods.push({provider,available:!reason,reason,requiresSwitch});
      }
      await app.authorize(db,s);return{orderId,paymentId:p?.id||null,client,policyVersion:policy.version,methods};
    });
  }
  async owned(s,orderId,db=this.db) {
    await this.app(s.applicationKey).authorize(db,s);
    const p=await db.paymentRecord.findFirst({where:{...scope(s),orderId:key(orderId),userId:s.userId,currentSlot:1}});
    if(!p)fail('PAYMENT_NOT_STARTED','订单尚未发起支付',404);return p;
  }
  async lease(db,model,p) {
    if(p.leaseUntil&&p.leaseUntil>new Date())fail('PAYMENT_BUSY','订单正在处理，请稍后查询',409);
    const token=randomUUID();await db[model].update({where:{id:p.id},data:{leaseToken:token,leaseUntil:new Date(Date.now()+30000),attempts:{increment:1},nextCheckAt:new Date(Date.now()+60000)}});return token;
  }
  async release(model,p,token,error) {
    await this.db[model].updateMany({where:{id:p.id,leaseToken:token},data:{leaseToken:null,leaseUntil:null,...(error?{lastError:code(error),nextCheckAt:new Date(Date.now()+Math.min(1800000,30000*2**Math.min(p.attempts,6)))}:{})}});
  }
  async pay(s,orderId,input={},context={},switchFrom=null) {
    if(input?.provider==='wechat-virtual')return this.virtual.pay(s,orderId,input,switchFrom);
    if(input?.provider==='alipay')return this.alipay.pay(s,orderId,input,context,switchFrom);
    if(input?.provider==='balance'){if(Object.keys(input).length!==1)fail('PAYMENT_INPUT_INVALID','支付金额和身份由服务端确定');key(orderId);return this.balance.pay(s,orderId,context,switchFrom)}
    this.assertEnabled();const parsed=z.object({channel:z.literal('h5').optional()}).strict().safeParse(input);if(!parsed.success)fail('PAYMENT_INPUT_INVALID','支付金额和身份由服务端确定');key(orderId);const h5=parsed.data.channel==='h5'?await this.h5Context(s,context):null;if(h5&&/MicroMessenger/i.test(context.userAgent||''))fail('PAYMENT_CLIENT_UNSUPPORTED','微信内请使用公众号微信支付',409);if(h5)h5.returnUrl+='&orderId='+encodeURIComponent(orderId);
    const prepared=await this.tx(async db=>{
      const app=this.app(s.applicationKey);await app.authorize(db,s);const order=await app.lock(db,s.tenantId,orderId);
      if(order.userId!==s.userId||order.consumerDeletedAt)fail('NOT_FOUND','订单不存在',404);
      const attempt=await this.attempt(db,s,orderId,'wechat',h5?'MWEB':'JSAPI',switchFrom);let p=attempt.p;
      if(p&&terminal(p))return {done:this.view(p,await this.latestRefund(db,p.id))};
      await app.payable(db,order);
      await this.clientPolicy.allowed(db,s,h5?'h5':s.authProvider==='wechat-official'?'official':'mini','wechat');
      if(!p){
        const row=await db.tenantPaymentRevision.findFirst({where:{...scope(s),provider:'wechat'},orderBy:{version:'desc'}});
        await this.clientPolicy.product(db,s,h5?'h5':s.authProvider==='wechat-official'?'official':'mini','wechat',app,order);
        if(!row||!paymentConfigured('wechat',row.config,row.secretFields))fail('PAYMENT_UNAVAILABLE','微信支付尚未配置完整',503);
        const config={...row.config,...this.settings.decrypt(row)};validatePaymentKeys('wechat',config,config,true);
        let openId;
        if(h5){if(config.apiVersion==='V2')fail('PAYMENT_H5_REQUIRES_V3','H5 支付请使用微信支付 V3 配置',409)}
        else{
          if(!['wechat','wechat-official'].includes(s.authProvider))fail('WECHAT_LOGIN_REQUIRED','请先完成微信身份授权',401);
          if(s.authProvider==='wechat-official'){const official=await db.tenantOfficialAccountSetting.findUnique({where:{tenantId_applicationKey:scope(s)}});if(!official?.config.appId||official.config.appId!==s.authAppId)fail('OFFICIAL_PAYMENT_APPID_MISMATCH','公众号与登录 AppID 不一致',409);config.appId=s.authAppId}
          else {if(s.authAppId!==config.appId)fail('WECHAT_LOGIN_REQUIRED','请使用当前小程序微信身份重新登录',401);const mini=await db.tenantMiniProgramSetting.findUnique({where:{tenantId_applicationKey:scope(s)}});if(!mini?.config.appId||mini.config.appId!==config.appId)fail('MINI_PAYMENT_APPID_MISMATCH','支付与小程序 AppID 不一致',409)}
          const identities=await db.consumerExternalIdentity.findMany({where:{...scope(s),userId:s.userId,provider:s.authProvider,appId:config.appId}});if(identities.length!==1)fail('PAYMENT_IDENTITY_UNAVAILABLE','微信身份不唯一或未绑定',409);openId=this.secrets.decrypt(identityAad(identities[0]),identities[0].identityCipher).openId;if(typeof openId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(openId))mismatch();
        }
        if(!Number.isSafeInteger(order.amount)||order.amount<=0||order.currency!=='CNY')fail('PAYMENT_AMOUNT_INVALID','微信支付仅支持有效的人民币正金额');
        p={id:id(),...scope(s),...attempt.lineage,orderId,userId:s.userId,provider:'wechat',revisionId:row.id,amount:order.amount,currency:order.currency,state:'PREPARING',expiresAt:new Date(Date.now()+15*60000)};
        this.urls(p);p.payerCipher=this.secrets.encrypt(payerAad(p),{openId,appId:config.appId,mode:h5?'MWEB':'JSAPI'});p=await db.paymentRecord.create({data:p});
      }
      if(p.closeRequested||p.expiresAt.getTime()-Date.now()<60000)fail('PAYMENT_CLOSING','支付已关闭或即将到期，请查询原订单',409);
      const config=await this.credentials(p,db),signingHash=hash(config.privateKey+(config.apiV2Key||''));
      const payer=this.payerData(p);if((payer.mode||'JSAPI')!==(h5?'MWEB':'JSAPI'))fail('PAYMENT_CHANNEL_MISMATCH','请使用原支付方式继续支付或查询原订单',409);
      if(h5&&payer.h5Url&&p.signingHash===signingHash)return{cached:{...this.view(p),redirectUrl:this.h5Redirect(payer.h5Url,h5.returnUrl)}};
      if(!h5&&(!['wechat','wechat-official'].includes(s.authProvider)||s.authAppId!==config.appId))fail('WECHAT_LOGIN_REQUIRED','请使用原微信身份重新登录',401);
      if(p.prepayId&&p.signingHash===signingHash)return{cached:{...this.view(p),paymentParams:this.gateway.clientParameters(config,p.prepayId)}};
      return{p,order,config,signingHash,token:await this.lease(db,'paymentRecord',p)};
    });
    if(prepared.done||prepared.cached)return prepared.done||prepared.cached;
    const {p,order,config,token,signingHash}=prepared;let error;
    try {
      if(h5){const response=await this.gateway.prepayH5(config,{appid:config.appId,mchid:config.mchId,description:Array.from(order.description).slice(0,40).join(''),out_trade_no:p.id,time_expire:p.expiresAt.toISOString(),notify_url:this.urls(p).notify,amount:{total:p.amount,currency:p.currency},scene_info:{payer_client_ip:h5.ip,h5_info:{type:'Wap',app_name:'QiCore',app_url:h5.origin}}});const redirectUrl=this.h5Redirect(response.data.h5_url,h5.returnUrl);return await this.tx(async db=>{await this.app(s.applicationKey).authorize(db,s);await this.clientPolicy.allowed(db,s,h5?'h5':s.authProvider==='wechat-official'?'official':'mini','wechat');const current=await this.locked(db,p);if(current.p.leaseToken!==token||current.p.closeRequested||terminal(current.p))return this.view(current.p);await db.paymentRecord.update({where:{id:p.id},data:{state:'READY',signingHash,lastError:null,payerCipher:this.secrets.encrypt(payerAad(p),{...this.payerData(p),h5Url:response.data.h5_url})}});return{...this.view({...current.p,state:'READY'}),redirectUrl}})}
      const response=await this.gateway.prepay(config,{appid:config.appId,mchid:config.mchId,description:Array.from(order.description).slice(0,40).join(''),out_trade_no:p.id,time_expire:p.expiresAt.toISOString(),notify_url:this.urls(p).notify,amount:{total:p.amount,currency:p.currency},payer:{openid:this.payer(p)}});
      const prepayId=response.data.prepay_id;if(typeof prepayId!=='string'||!/^[\w=-]{1,116}$/.test(prepayId))fail('PAYMENT_RESPONSE_INVALID','支付参数未确认',503);
      return await this.tx(async db=>{await this.app(s.applicationKey).authorize(db,s);await this.clientPolicy.allowed(db,s,h5?'h5':s.authProvider==='wechat-official'?'official':'mini','wechat');const current=await this.locked(db,p);
        if(current.p.leaseToken!==token||current.p.closeRequested||terminal(current.p))return this.view(current.p);
        await db.paymentRecord.update({where:{id:p.id},data:{state:'READY',prepayId,signingHash,lastError:null}});
        return{...this.view({...current.p,state:'READY'}),paymentParams:this.gateway.clientParameters(config,prepayId)};
      });
    } catch(e){error=e;fail('PAYMENT_UNCONFIRMED','支付发起结果未确认，请查询原订单后重试',503)}
    finally{await this.release('paymentRecord',p,token,error)}
  }
  validate(p,config,data) {
    if(p.provider==='alipay')return this.alipay.validate(p,config,data);
    if(p.provider==='wechat-virtual')return this.virtual.validate(p,config,data);
    const mode=this.payerData(p).mode||'JSAPI';if(data.mchid!==config.mchId||data.appid!==config.appId||data.out_trade_no!==p.id||data.trade_state!=='SUCCESS'||data.trade_type!==mode||mode==='JSAPI'&&data.payer?.openid!==this.payer(p)||data.amount?.total!==p.amount||data.amount.currency!==p.currency||data.amount.payer_currency!==p.currency||!cents(data.amount.payer_total)||data.amount.payer_total>p.amount||typeof data.transaction_id!=='string'||!/^\w{1,64}$/.test(data.transaction_id)||!when(data.success_time))mismatch();
    if(p.transactionId&&(p.transactionId!==data.transaction_id||p.payerTotal!==data.amount.payer_total))mismatch();
  }
  async settle(db,p,data) {
    const {p:current,order}=await this.locked(db,p),config=await this.credentials(current,db);this.validate(current,config,data);
    if(current.paidAt)return;
    if(current.state==='REVIEW')fail('PAYMENT_REVIEW_REQUIRED','外部资金状态等待核查',409);
    const paid={...current,transactionId:data.transaction_id,payerTotal:data.amount.payer_total,paidAt:new Date(data.success_time)};
    const superseded=current.currentSlot===null;
    const compensate=superseded||await this.app(p.applicationKey).settle(db,order,paid);
    await db.paymentRecord.update({where:{id:p.id},data:{state:compensate?'COMPENSATION':'PAID',transactionId:paid.transactionId,payerTotal:paid.payerTotal,paidAt:paid.paidAt,lastError:null}});
    if(!compensate)await this.app(p.applicationKey).afterSettlement?.(db,order,paid);
    if(superseded){
      // This receipt never fulfilled the order: refund only its own money. Do not
      // revoke the winning attempt's assets, subscription or consumption growth.
      await db.paymentRefund.create({data:{id:id(),paymentId:p.id,amount:p.amount,source:'compensation',reason:'切换前的支付迟到到账，原路退回该笔资金',state:'PENDING'}});
      await db.audit.create({data:{id:randomUUID(),scope:'tenant',...scope(p),actor:'system',action:'payment.superseded.compensation',details:{orderId:p.orderId,paymentId:p.id,amountCents:p.amount}}});
    }else if(compensate)await this.createRefund(db,paid,await this.app(p.applicationKey).lock(db,p.tenantId,p.orderId),'无法交付原订单权益，自动原路退款');
  }
  async createRefund(db,p,order,reason,options={}) {
    const summary=await this.refundSummary(db,p),old=summary.rows[0];
    if(options.requestKey){const duplicate=summary.rows.find(r=>r.requestKey===options.requestKey);if(duplicate){if(duplicate.source!=='admin'||duplicate.reason!==reason||(duplicate.amount??p.amount)!==options.amount)fail('REFUND_REQUEST_CONFLICT','同一退款请求不能更换金额或原因',409);return duplicate}}
    else if(old&&old.state!=='REJECTED')return old;
    if(summary.busy)fail(old?.state==='APPLIED'?'REFUND_REVIEW_REQUIRED':'REFUND_IN_PROGRESS',old?.state==='APPLIED'?'请先在售后订单中审核用户申请':'已有退款正在处理或等待核查，请先查询原结果',409);
    const amount=options.amount??summary.remaining;if(!Number.isSafeInteger(amount)||amount<=0||amount>summary.remaining)fail('REFUND_AMOUNT_INVALID','退款金额必须大于零且不超过剩余可退金额',409);
    if(p.provider==='alipay'&&order.status!=='compensation_due')this.alipay.assertRefund(p);
    if(p.provider==='wechat-virtual'&&order.status!=='compensation_due')this.virtual.assertRefund(p);
    await this.app(p.applicationKey).reserveRefund(db,order);
    return db.paymentRefund.create({data:{id:id(),paymentId:p.id,sequence:(old?.sequence||0)+1,requestKey:options.requestKey||null,amount,source:order.status==='compensation_due'?'compensation':'admin',reason,state:'PENDING'}});
  }
  async requestRefund(s,tenantId,applicationKey,orderId,input) {
    const parsed=z.object({reason:z.string().trim().min(1).max(200),amountCents:z.number().int().positive().max(100000000).optional(),requestKey:z.uuid().optional()}).strict().refine(v=>(v.amountCents===undefined)===(v.requestKey===undefined)).safeParse(input);if(!parsed.success)fail('REFUND_INPUT_INVALID','请填写有效的退款金额、原因和请求编号');
    const refund=await this.tx(async db=>{
      await this.settings.apps.admin(s,tenantId,applicationKey,'orders.manage',db,true);
      const found=await db.paymentRecord.findFirst({where:{tenantId,applicationKey,orderId:key(orderId),currentSlot:1}});if(!found)fail('PAYMENT_NOT_STARTED','没有可退款的真实支付记录',409);
      if(found.provider!=='balance')this.assertEnabled();
      const {p,order}=await this.locked(db,found);if(!p.paidAt||!['PAID','PARTIAL_REFUND','COMPENSATION','REFUNDED'].includes(p.state))fail('REFUND_NOT_ALLOWED','支付尚未确认或等待核查',409);
      const r=await this.createRefund(db,p,order,parsed.data.reason,{amount:parsed.data.amountCents,requestKey:parsed.data.requestKey});
      if(r.state==='APPLIED')fail('REFUND_REVIEW_REQUIRED','请先在售后订单中审核用户申请',409);
      if(r.source==='admin'&&!r.reviewedAt){await db.paymentRefund.update({where:{id:r.id},data:{reviewedBy:s.id,reviewReason:parsed.data.reason,reviewedAt:new Date()}});
      await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:s.impersonatedBy||s.id,action:'payment.refund.request',details:{orderId,refundId:r.id,amountCents:r.amount??p.amount,...(s.delegated?{targetAdminId:s.id}:{})}}});}return r;
    });
    // Durable intent is the response. Worker acceptance and successful refund are distinct states.
    const paid=await this.db.paymentRecord.findUnique({where:{id:refund.paymentId}});if(paid?.provider==='balance'&&refund.state==='PENDING')await this.balance.refund(refund.id);
    const current=await this.db.paymentRefund.findUnique({where:{id:refund.id}});return {id:current.id,state:current.state,amountCents:current.amount};
  }
  async status(s,orderId,refresh=false) {
    const p=await this.tx(db=>this.owned(s,orderId,db));if(refresh&&p.provider!=='balance'){this.assertEnabled();await this.reconcile(p.id)}
    return this.tx(async db=>{const current=await this.owned(s,orderId,db);return this.view(current,await this.latestRefund(db,current.id))});
  }
  async cancel(s,orderId) {
    const existing=await this.tx(db=>this.owned(s,orderId,db));if(existing.provider==='balance')return this.status(s,orderId);
    this.assertEnabled();const p=await this.tx(async db=>{const app=this.app(s.applicationKey);await app.authorize(db,s);await app.lock(db,s.tenantId,orderId);const found=await this.owned(s,orderId,db),{p,order}=await this.locked(db,found);if(p.state==='CLOSED'&&!p.paidAt){await app.cancel(db,order);await db.paymentRecord.update({where:{id:p.id},data:{closeRequested:true,closeReason:'cancel'}})}else if(!terminal(p))await db.paymentRecord.update({where:{id:p.id},data:{closeRequested:true,closeReason:'cancel',nextCheckAt:new Date()}});return p});
    await this.reconcile(p.id);return this.status(s,orderId);
  }
  async reconcile(paymentId) {
    this.assertEnabled();const found=await this.db.paymentRecord.findUnique({where:{id:paymentId}});if(!found)return;
    if(found.provider==='alipay')return this.alipay.reconcile(paymentId);
    if(found.provider==='wechat-virtual')return this.virtual.reconcile(paymentId);
    const prepared=await this.tx(async db=>{const {p}=await this.locked(db,found);if(terminal(p))return null;return{p,token:await this.lease(db,'paymentRecord',p),config:await this.credentials(p,db)}});if(!prepared)return;
    const {p,token,config}=prepared;let error;
    try {
      let data;try{({data}=await this.gateway.query(config,p.id))}catch(e){
        if(e.authenticated&&['ORDER_NOT_EXIST','ORDERNOTEXIST'].includes(e.code)&&(p.closeRequested||p.expiresAt<=new Date())){
          if(p.expiresAt>new Date()){await this.db.paymentRecord.updateMany({where:{id:p.id,leaseToken:token},data:{nextCheckAt:p.expiresAt,lastError:'PAYMENT_CLOSE_WAIT_EXPIRY'}});return}
          data={mchid:config.mchId,appid:config.appId,out_trade_no:p.id,trade_state:'CLOSED'};
        }else throw e;
      }
      if(data.mchid!==config.mchId||data.appid!==config.appId||data.out_trade_no!==p.id)mismatch();
      if(data.trade_state==='SUCCESS'){await this.tx(db=>this.settle(db,p,data));return}
      if(data.trade_state==='REFUND'){await this.db.paymentRecord.updateMany({where:{id:p.id,paidAt:null},data:{state:'REVIEW',lastError:'EXTERNAL_REFUND'}});return}
      let closed=['CLOSED','REVOKED'].includes(data.trade_state);
      if(!closed&&!['NOTPAY','USERPAYING','PAYERROR'].includes(data.trade_state))mismatch();
      const latest=await this.db.paymentRecord.findUnique({where:{id:p.id}});
      if(!closed&&(latest.closeRequested||p.expiresAt<=new Date())){await this.gateway.close(config,p.id);closed=true}
      if(closed)await this.tx(db=>this.closed(db,p,token));
    }catch(e){error=e;throw e}finally{await this.release('paymentRecord',p,token,error)}
  }
  validateRefund(p,r,config,data) {
    if(p.provider==='alipay')return this.alipay.validateRefund(p,r,config,data);
    if(p.provider==='wechat-virtual')return this.virtual.validateRefund(p,r,config,data);
    const state=data.refund_status||data.status;
    if(data.mchid!==undefined&&data.mchid!==config.mchId||data.appid!==undefined&&data.appid!==config.appId||data.out_trade_no!==p.id||data.transaction_id!==p.transactionId||data.out_refund_no!==r.id||!['SUCCESS','PROCESSING','ABNORMAL','CLOSED'].includes(state)||typeof data.refund_id!=='string'||!/^\w{1,64}$/.test(data.refund_id)||data.amount?.total!==p.amount||data.amount.refund!==(r.amount??p.amount)||data.amount.currency!==p.currency||!cents(data.amount.payer_refund)||data.amount.payer_refund>Math.min(p.payerTotal,r.amount??p.amount)||state==='SUCCESS'&&(!when(data.success_time)||(r.amount??p.amount)===p.amount&&data.amount.payer_refund!==p.payerTotal||p.payerTotal===p.amount&&data.amount.payer_refund!==(r.amount??p.amount)))mismatch();
    if(r.refundId&&r.refundId!==data.refund_id||r.state==='SUCCESS'&&r.payerRefund!==data.amount.payer_refund)mismatch();return state;
  }
  async applyRefund(db,p,r,data) {
    const current=await this.locked(db,p);await db.$queryRaw`SELECT id FROM PaymentRefund WHERE id=${r.id} FOR UPDATE`;
    const row=await db.paymentRefund.findUnique({where:{id:r.id}}),config=await this.credentials(p,db),state=this.validateRefund(current.p,row,config,data);
    if(row.state==='SUCCESS')return;
    if(row.state==='CLOSED'){if(state!=='CLOSED')mismatch();return}
    if(['APPLIED','REJECTED'].includes(row.state))mismatch();
    const summary=await this.refundSummary(db,current.p),total=summary.refunded+(row.amount??p.amount),payerTotal=summary.payerRefunded+data.amount.payer_refund;if(state==='SUCCESS'&&(total>p.amount||payerTotal>p.payerTotal||total===p.amount&&payerTotal!==p.payerTotal))mismatch();
    await db.paymentRefund.update({where:{id:r.id},data:{state,refundId:data.refund_id,payerRefund:data.amount.payer_refund,succeededAt:state==='SUCCESS'?new Date(data.success_time):null,lastError:state==='CLOSED'?'REFUND_REVIEW_REQUIRED':null,nextCheckAt:new Date(Date.now()+(state==='ABNORMAL'?1800000:60000))}});
    if(state==='SUCCESS'){const full=total===p.amount;if(current.p.currentSlot===1)await this.app(p.applicationKey).refunded(db,current.order,full);await db.paymentRecord.update({where:{id:p.id},data:{state:full?'REFUNDED':'PARTIAL_REFUND'}})}
  }
  async processRefund(refundId) {
    const row=await this.db.paymentRefund.findUnique({where:{id:refundId}});if(!row)return;
    const found=await this.db.paymentRecord.findUnique({where:{id:row.paymentId}});if(!found)mismatch();
    if(found.provider==='alipay')return this.alipay.processRefund(refundId);
    if(found.provider==='wechat-virtual')return this.virtual.processRefund(refundId);
    if(found.provider==='balance')return this.balance.refund(refundId);this.assertEnabled();
    const prepared=await this.tx(async db=>{const {p}=await this.locked(db,found);await db.$queryRaw`SELECT id FROM PaymentRefund WHERE id=${row.id} FOR UPDATE`;const r=await db.paymentRefund.findUnique({where:{id:row.id}});if(!['PENDING','PROCESSING','ABNORMAL'].includes(r.state))return null;return{p,r,config:await this.credentials(p,db),token:await this.lease(db,'paymentRefund',r)}});if(!prepared)return;
    const {p,r,config,token}=prepared;let error;
    try {
      // Reuse one refund number after an ambiguous response; never issue a second refund.
      const response=r.refundId?await this.gateway.queryRefund(config,r.id):await this.gateway.refund(config,{out_trade_no:p.id,out_refund_no:r.id,transaction_id:p.transactionId,reason:r.reason,notify_url:this.urls(p).refund,amount:{total:p.amount,refund:r.amount??p.amount,currency:p.currency}});
      await this.tx(db=>this.applyRefund(db,p,r,response.data));
    }catch(e){error=e;throw e}finally{await this.release('paymentRefund',r,token,error)}
  }
  async accept(paymentId,kind,raw,headers) {
    key(paymentId);if(!Buffer.isBuffer(raw)||raw.length>262144||!['payment','refund'].includes(kind))fail('PAYMENT_NOTICE_INVALID','支付通知格式无效');
    const p=await this.db.paymentRecord.findUnique({where:{id:paymentId}});if(!p)fail('NOT_FOUND','支付记录不存在',404);
    if(p.provider!=='wechat')fail('PAYMENT_NOTICE_INVALID','支付通知渠道不匹配');
    const config=await this.credentials(p),xml=isXmlNotice(raw);if(xml!==(config.apiVersion==='V2'))mismatch();
    let notice,data;
    try {
      if(xml){if(kind==='refund')this.assertEnabled();({notice,data}=await this.gateway.noticeV2(kind==='payment'?'PAYMENT':'REFUND',raw,config.trusted))}
      else{const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);this.gateway.verifyMessage(text,headers,config.trusted);notice=JSON.parse(text);for(const c of config.trusted){try{data=this.gateway.decrypt(notice.resource,c);break}catch{}}}
      if(!data||typeof notice.id!=='string'||notice.id.length>128||notice.event_type!==(kind==='payment'?'TRANSACTION.SUCCESS':'REFUND.'+(data.refund_status||data.status)))mismatch();
      if(kind==='payment')this.validate(p,config,data);else{const r=await this.db.paymentRefund.findUnique({where:{id:data.out_refund_no}});if(!r||r.paymentId!==p.id)mismatch();this.validateRefund(p,r,config,data)}
    }catch(e){fail('PAYMENT_NOTICE_INVALID','支付通知验签或内容核验失败',400)}
    const n={id:hash('wechat:'+p.id+':'+notice.id),paymentId:p.id,kind,payloadHash:hash(JSON.stringify(data)),state:'PENDING'};
    await this.tx(async db=>{const old=await db.paymentNotice.findUnique({where:{id:n.id}});if(old){if(old.payloadHash!==n.payloadHash||old.kind!==kind)mismatch();return}await db.paymentNotice.create({data:{...n,payloadCipher:this.secrets.encrypt(noticeAad(p,n),data)}})});
    return xml?{status:200,type:'text/xml',body:v2Acknowledgement(true)}:{status:204,body:''};
  }
  async processNotice(id) {
    const n=await this.db.paymentNotice.findUnique({where:{id}});if(!n||n.state==='DONE')return;
    const p=await this.db.paymentRecord.findUnique({where:{id:n.paymentId}});if(!p)mismatch();
    if(p.provider==='alipay')return this.alipay.processNotice(n,p);
    if(p.provider==='wechat-virtual')return this.virtual.processNotice(n,p);
    try{await this.tx(async db=>{await this.locked(db,p);await db.$queryRaw`SELECT id FROM PaymentNotice WHERE id=${id} FOR UPDATE`;const current=await db.paymentNotice.findUnique({where:{id}});if(current.state==='DONE')return;
      const data=this.secrets.decrypt(noticeAad(p,n),n.payloadCipher);
      if(n.kind==='payment')await this.settle(db,p,data);else{const r=await db.paymentRefund.findUnique({where:{id:data.out_refund_no}});if(!r||r.paymentId!==p.id)mismatch();await this.applyRefund(db,p,r,data)}
      await db.paymentNotice.update({where:{id},data:{state:'DONE',lastError:null}});
    })}catch(e){await this.db.paymentNotice.updateMany({where:{id,state:'PENDING'},data:{attempts:{increment:1},lastError:code(e),nextCheckAt:new Date(Date.now()+Math.min(1800000,30000*2**Math.min(n.attempts,6)))}});throw e}
  }
  async tick() {
    if(this.busy)return;this.busy=true;
    try{
      if(!this.enabled){for(const r of await this.db.paymentRefund.findMany({where:{state:'PENDING',payment:{provider:'balance'}},take:10}))try{await this.balance.refund(r.id)}catch(e){logFailure(e,{operation:'payment.balance.refund',recordId:r.id})}return}
      for(const n of await this.db.paymentNotice.findMany({where:{state:'PENDING',nextCheckAt:{lte:new Date()}},orderBy:{nextCheckAt:'asc'},take:20}))try{await this.processNotice(n.id)}catch(e){logFailure(e,{operation:'payment.notice',recordId:n.id})}
      for(const p of await this.db.paymentRecord.findMany({where:{state:{in:['PREPARING','READY']},nextCheckAt:{lte:new Date()},OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},orderBy:{nextCheckAt:'asc'},take:10}))try{await this.reconcile(p.id)}catch(e){logFailure(e,{operation:'payment.reconcile',recordId:p.id})}
      for(const p of await this.db.paymentRecord.findMany({where:{provider:'wechat-virtual',state:{in:['PAID','PARTIAL_REFUND','COMPENSATION','REVIEW']},paidAt:{gte:new Date(Date.now()-366*86400000)},nextCheckAt:{lte:new Date()},OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},orderBy:{nextCheckAt:'asc'},take:10}))try{await this.virtual.reconcile(p.id)}catch(e){logFailure(e,{operation:'payment.virtual.reconcile',recordId:p.id})}
      for(const r of await this.db.paymentRefund.findMany({where:{state:{in:['PENDING','PROCESSING','ABNORMAL']},nextCheckAt:{lte:new Date()},OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},orderBy:{nextCheckAt:'asc'},take:10}))try{await this.processRefund(r.id)}catch(e){logFailure(e,{operation:'payment.refund',recordId:r.id})}
    }finally{this.busy=false}
  }
}
