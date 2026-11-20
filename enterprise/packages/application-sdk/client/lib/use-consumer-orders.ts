import {useMaintenanceReload} from './maintenance'
import {computed,ref} from 'vue'
import {onShow,onUnload,onLoad} from '@dcloudio/uni-app'
import {payOrder,queryOrder} from './order-payment'
import type {ConsumerOrderDetail as OrderDetail} from './order-display'
import type {ConsumerOrder,ConsumerOrderDetail,ConsumerAfterSale} from './order-display'
import {normalizeOrder,paymentState} from './order-display'
import {consumerReady,consumerLogin,readWallet,rechargeClient,type PaymentMethod} from './wallet'
import {api,ApiError,isClientPreview,getToken,identityScope,requestKey,message,money} from './api'
import {readPaymentSwitch,rememberPaymentSwitch,forgetPaymentSwitch,type PaymentSwitch} from './payment-switch'
import {virtualPaymentUnavailableReason} from './virtual-payment'

export function useConsumerOrders(packages=false){
type Sale=ConsumerAfterSale
type Order=ConsumerOrder
type Listing={demo?:boolean;items:Order[];total:number;page:number;pageSize:number}
const states:Record<string,string>={APPLIED:'等待商家审核',REJECTED:'申请未通过',PENDING:'已同意，等待提交退款',PROCESSING:'退款处理中',ABNORMAL:'退款待商家核查',CLOSED:'退款关闭，等待商家处理',SUCCESS:'退款成功'}
const orderStates:Record<string,string>={pending:'待支付',paid:'已支付',cancelled:'已取消',compensation_due:'待补偿',refund_pending:'退款处理中',partial_refund:'部分退款',refunded:'已退款'}
const rows=ref<Listing>({items:[],total:0,page:1,pageSize:20}),page=ref(1),loadAction=ref<string|null>(null),error=ref(''),selected=ref<Order|null>(null),reason=ref(''),draftRequestKey=ref(''),submitting=ref(false),formError=ref(''),history=ref<Sale[]|null>(null),historyOrder=ref(''),historyBusy=ref(''),historyError=ref('')
const paymentAction=ref(''),returnedOrder=ref(''),status=ref('all'),demo=ref(false),guest=ref(false)
const detailTarget=ref<Partial<Order>&{id:string}|null>(null),detailData=ref<ConsumerOrderDetail|null>(null),detailAction=ref(''),detailError=ref(''),panel=ref<'detail'|'payment'|null>(null),method=ref('')
const methods=ref<PaymentMethod[]>([]),methodsAction=ref(''),methodsError=ref(''),balanceCents=ref<number|null>(null),paying=ref(false),querying=ref(false),payError=ref(''),paymentUnknown=ref(false)
const paymentId=ref<string|null>(null),switchIntent=ref<PaymentSwitch|null>(null)
const rechargeOrder=computed(()=>['points_recharge','balance_recharge'].includes(detailData.value?.kind||''))
const selectedMethod=computed(()=>methods.value.find(item=>item.provider===method.value)),requiresSwitch=computed(()=>!!switchIntent.value||!!selectedMethod.value?.requiresSwitch)
const payLabel=computed(()=>switchIntent.value?'继续切换':requiresSwitch.value?'更换并支付':'确认支付')
const switchReason=computed(()=>!switchIntent.value?'':switchIntent.value.client!==rechargeClient()?'请在发起切换的原支付端继续，当前可查询订单状态。':selectedMethod.value?.available?'':selectedMethod.value?.reason||'尚未取得目标支付方式，请重新查询')
const canPay=computed(()=>!demo.value&&rechargeOrder.value&&!paymentUnknown.value&&['balance','wechat','alipay','wechat-virtual'].includes(method.value)&&(method.value!=='alipay'||rechargeClient()==='h5')&&(method.value!=='wechat-virtual'||!virtualPaymentUnavailableReason())&&!(detailData.value?.kind==='balance_recharge'&&method.value==='balance')&&detailData.value?.status==='pending'&&paymentState(detailData.value)==='pending'&&selectedMethod.value?.available===true&&(!requiresSwitch.value||/^[a-f0-9]{32}$/.test(switchIntent.value?.paymentId||paymentId.value||''))&&(!switchIntent.value||switchIntent.value.phase==='waiting'&&switchIntent.value.client===rechargeClient()&&switchIntent.value.provider===method.value)&&!methodsAction.value&&!paying.value&&!querying.value&&!detailAction.value)
let detailSequence=0,methodsSequence=0,returnedFromCashier=false
const confirmation=ref<{order:Order;kind:'cancel'|'delete'}|null>(null),actionError=ref(''),notice=ref('')
const filters=[{value:'all',label:'全部'},{value:'pending',label:'待付款'},{value:'paid',label:'已支付'},{value:'refunded',label:'已退款'},{value:'cancelled',label:'已取消'}]
function filter(value:string){if(paying.value||querying.value||submitting.value||paymentAction.value||confirmation.value||selected.value||status.value===value||!filters.some(item=>item.value===value))return;closeDetails();status.value=value;page.value=1;rows.value={...rows.value,items:[],total:0,page:1};void load('filter:'+value)}
let alive=true,sequence=0,historySequence=0,submitSequence=0,actionSequence=0,currentScope=''
const session=()=>identityScope()+'|'+getToken()
function resetPrivateState(scope=session()){
 currentScope=scope;rows.value={items:[],total:0,page:1,pageSize:20};page.value=1
 submitSequence++;actionSequence++;selected.value=null;reason.value='';draftRequestKey.value='';formError.value='';submitting.value=false
 closeHistory();confirmation.value=null;actionError.value='';notice.value='';paymentAction.value='';paying.value=false;querying.value=false;closeDetails()
}
function clearChangedIdentity(scope:string){
 if(!alive||scope===session()||currentScope===session())return
 sequence++;loadAction.value=null;resetPrivateState();guest.value=!getToken();error.value=guest.value?'':'登录状态已变化，请重新读取订单'
}
function clearDeniedIdentity(e:unknown,scope:string){
 if(alive&&session()===scope&&e instanceof ApiError&&[401,403].includes(e.status)){
  sequence++;loadAction.value=null;resetPrivateState();guest.value=!getToken();error.value=guest.value?'':message(e);return true
 }
 clearChangedIdentity(scope);return session()!==scope
}
function requestAction(order:Order,kind:'cancel'|'delete'){
 if(demo.value||paymentAction.value||submitting.value||loadAction.value||selected.value||session()!==currentScope)return
 if(kind==='cancel'?order.status!=='pending':!order.canDelete)return
 confirmation.value={order,kind};actionError.value=''
}
function closeAction(){if(!paymentAction.value){confirmation.value=null;actionError.value=''}}
async function confirmAction(){
 if(demo.value||!confirmation.value||paymentAction.value||submitting.value)return
 const {order,kind}=confirmation.value,scope=session();if(scope!==currentScope){closeAction();await load();return}
 const attempt=++actionSequence;paymentAction.value=kind+':'+order.id;actionError.value='';notice.value=''
 try{
  if(kind==='delete'){
   const result=await api<{deleted:boolean}>('/orders/'+encodeURIComponent(order.id),'DELETE');if(!alive||attempt!==actionSequence||session()!==scope)return
   if(!result.deleted)throw Error('删除结果尚未确认，请重新读取订单')
   rows.value.items=rows.value.items.filter(item=>item.id!==order.id);rows.value.total=Math.max(0,rows.value.total-1)
   const recent='zjz-package-last:'+identityScope();if(uni.getStorageSync(recent)===order.id)uni.removeStorageSync(recent)
   history.value=null;notice.value='订单已删除'
  }else{
   const result=await api<OrderDetail>('/orders/'+encodeURIComponent(order.id)+'/cancel','POST');if(!alive||attempt!==actionSequence||session()!==scope)return
   notice.value=result.status==='cancelled'?'订单已取消':result.status==='paid'?'订单已支付，无法取消':'订单状态：'+(orderStates[result.status]||'处理中')
  }
  confirmation.value=null;await load('mutation')
 }catch(e){if(alive&&attempt===actionSequence&&!clearDeniedIdentity(e,scope))actionError.value=message(e)}finally{clearChangedIdentity(scope);if(alive&&attempt===actionSequence)paymentAction.value=''}
}
const time=(v:string)=>new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})
async function load(source='initial'){
 const n=++sequence,preview=demo.value;let scope=session();loadAction.value=source;if(source!=='retry')error.value=''
 if(scope!==currentScope)resetPrivateState(scope)
 try{
  const ready=preview||await consumerReady();if(!alive||n!==sequence)return
  if(!ready){resetPrivateState();guest.value=true;return}
  guest.value=false;scope=session();if(scope!==currentScope)resetPrivateState(scope)
  const result=await api<Listing>((preview?'/dev/orders':'/orders')+'?page='+page.value+'&pageSize=20&status='+status.value+(packages?'&category=packages':''))
  if(alive&&n===sequence&&session()===scope&&demo.value===preview){if(preview&&result.demo!==true)throw Error('演示订单读取失败');rows.value={...result,items:result.items.map(item=>normalizeOrder(item))};page.value=result.page;error.value=''}
 }catch(e){if(alive&&n===sequence&&!clearDeniedIdentity(e,scope)){guest.value=!getToken()&&!preview;error.value=guest.value?'':message(e);if(guest.value)resetPrivateState()}}
 finally{clearChangedIdentity(scope);if(alive&&n===sequence)loadAction.value=null}
}
function open(order:Order){if(demo.value||!alive||session()!==currentScope){clearChangedIdentity(currentScope);return}if(!order.canApply||selected.value||submitting.value||paymentAction.value||confirmation.value)return;closeHistory();closeDetails();selected.value=order;reason.value='';draftRequestKey.value=requestKey();formError.value=''}
async function cancel(){if(submitting.value)return;const scope=session(),order=selected.value;if(reason.value.trim()){const result=await uni.showModal({title:'放弃申请内容？',content:'尚未提交的退款原因将被清空。',confirmText:'放弃修改',cancelText:'继续编辑'});clearChangedIdentity(scope);if(!alive||session()!==scope||selected.value!==order||!result.confirm)return}selected.value=null;reason.value='';draftRequestKey.value='';formError.value=''}
async function submit(){
 if(demo.value||!selected.value||submitting.value)return;if(!reason.value.trim()){formError.value='请填写退款原因';return}
 const scope=session();if(scope!==currentScope){clearChangedIdentity(currentScope);return}
 const id=selected.value.id,attempt=++submitSequence;submitting.value=true;formError.value=''
 try{await api('/orders/'+encodeURIComponent(id)+'/after-sales','POST',{requestKey:draftRequestKey.value,reason:reason.value.trim()});if(!alive||attempt!==submitSequence||session()!==scope)return;selected.value=null;reason.value='';draftRequestKey.value='';uni.showToast({title:'申请已提交，等待审核',icon:'none'});await load('mutation')}
 catch(e){if(alive&&attempt===submitSequence&&!clearDeniedIdentity(e,scope))formError.value=message(e)}finally{clearChangedIdentity(scope);if(alive&&attempt===submitSequence)submitting.value=false}
}
async function readHistory(order:Pick<Order,'id'>,retry=false){
 if(demo.value||!alive||session()!==currentScope){clearChangedIdentity(currentScope);return}
 if(submitting.value||paymentAction.value||selected.value||confirmation.value||historyBusy.value===order.id)return
 closeDetails();const n=++historySequence,scope=session();historyBusy.value=order.id
 if(!retry){history.value=null;historyError.value=''}historyOrder.value=order.id
 try{const result=await api<Sale[]>('/orders/'+encodeURIComponent(order.id)+'/after-sales');if(alive&&n===historySequence&&session()===scope){history.value=result;historyError.value=''}}
 catch(e){if(alive&&n===historySequence&&!clearDeniedIdentity(e,scope))historyError.value=message(e)}
 finally{clearChangedIdentity(scope);if(alive&&n===historySequence)historyBusy.value=''}
}
function retryHistory(){if(historyOrder.value&&!historyBusy.value)void readHistory({id:historyOrder.value},true)}
function closeHistory(){historySequence++;historyOrder.value='';history.value=null;historyBusy.value='';historyError.value=''}
function turn(delta:number){if(paying.value||querying.value||loadAction.value||submitting.value||page.value+delta<1||page.value+delta>Math.max(1,Math.ceil(rows.value.total/rows.value.pageSize)))return;closeDetails();page.value+=delta;void load(delta<0?'page:previous':'page:next')}
async function payment(order:Pick<Order,'id'>,kind:'pay'|'query'){if(demo.value||paymentAction.value||submitting.value)return;const scope=session();if(scope!==currentScope){clearChangedIdentity(currentScope);return}const attempt=++actionSequence;paymentAction.value=kind+':'+order.id;error.value='';try{const detail=await api<OrderDetail>('/orders/'+encodeURIComponent(order.id));if(!alive||attempt!==actionSequence||session()!==scope)return;await(kind==='pay'?payOrder(detail):queryOrder(detail));if(alive&&attempt===actionSequence&&session()===scope)await load('mutation')}catch(e){if(alive&&attempt===actionSequence&&!clearDeniedIdentity(e,scope))error.value=message(e)}finally{clearChangedIdentity(scope);if(alive&&attempt===actionSequence)paymentAction.value=''}}
function closeDetails(){if(paying.value||querying.value)return;detailSequence++;methodsSequence++;panel.value=null;detailTarget.value=null;detailData.value=null;detailAction.value='';detailError.value='';methods.value=[];methodsAction.value='';methodsError.value='';payError.value='';paymentUnknown.value=false;balanceCents.value=null;method.value='';paymentId.value=null;switchIntent.value=null}
function recoverSwitch(order:ConsumerOrderDetail,queried=false){
 const pending=switchIntent.value;if(!pending)return
 const payment=order.payment
 if(order.status!=='pending'||paymentState(order)==='cancelled'||payment?.previousPaymentId===pending.paymentId&&payment.provider===pending.provider){forgetPaymentSwitch(order.id,pending);switchIntent.value=null;return}
 if(queried&&payment?.paymentId){if(payment.paymentId===pending.paymentId){switchIntent.value={...pending,phase:'waiting'};rememberPaymentSwitch(order.id,switchIntent.value)}else{forgetPaymentSwitch(order.id,pending);switchIntent.value=null;payError.value='支付方式已变化，已读取当前订单，请重新选择'}}
 if(switchIntent.value)method.value=switchIntent.value.provider
}
async function readDetails(source='initial'){
 if(!detailTarget.value||detailAction.value)return
 const order={...detailTarget.value},attempt=++detailSequence,scope=session(),preview=demo.value;detailAction.value=source;if(source!=='retry')detailError.value=''
 try{const value=await api<any>(preview?'/dev/order-detail?id='+encodeURIComponent(order.id):'/orders/'+encodeURIComponent(order.id));if(!alive||attempt!==detailSequence)return;if(scope!==session()||preview!==demo.value){closeDetails();return;}
  if(preview&&(value.demo!==true||value.missing))throw Error('演示订单暂不可用');if(value.id!==order.id)throw Error('订单详情不匹配');
  detailData.value=normalizeOrder(value,order);detailError.value='';method.value=value.method||value.payment?.provider||'';switchIntent.value=preview?null:readPaymentSwitch(order.id);recoverSwitch(detailData.value);if(switchIntent.value){method.value=switchIntent.value.provider;paymentUnknown.value=switchIntent.value.phase!=='waiting'}if(detailData.value.status==='pending'&&detailData.value.payment?.provider==='wechat-virtual'&&['READY','PREPARING'].includes(detailData.value.payment.state))paymentUnknown.value=true;if(returnedFromCashier){returnedFromCashier=false;if(detailData.value.payment&&detailData.value.status==='pending')paymentUnknown.value=true}if(panel.value==='payment')void readMethods()
 }catch(e){if(alive&&attempt===detailSequence&&!clearDeniedIdentity(e,scope)){if(preview!==demo.value)closeDetails();else detailError.value=message(e)}}finally{clearChangedIdentity(scope);if(alive&&attempt===detailSequence)detailAction.value=''}
}
function openDetails(order:Partial<Order>&{id:string},view:'detail'|'payment'='detail'){
 if(!alive||!demo.value&&session()!==currentScope){clearChangedIdentity(currentScope);return}
 if(submitting.value||paymentAction.value||confirmation.value||selected.value||paying.value||querying.value)return
 closeHistory();closeDetails();detailTarget.value={...order};panel.value=view;void readDetails()
}
function switchPanel(view:'detail'|'payment'){if(detailData.value&&!detailAction.value&&!paying.value&&!querying.value){panel.value=view;detailError.value='';if(view==='payment')void readMethods()}}
async function readMethods(source='initial'){
 if(demo.value||!rechargeOrder.value||!detailData.value||methodsAction.value)return
 const id=detailData.value.id,n=detailSequence,attempt=++methodsSequence,scope=session();methodsAction.value=source;if(source!=='retry')methodsError.value='';methods.value=[];paymentId.value=null
 try{const [value,wallet]=await Promise.all([api<{orderId:string;paymentId?:string|null;methods:PaymentMethod[]}>('/recharge/orders/'+encodeURIComponent(id)+'/methods?client='+rechargeClient()),readWallet()]);if(!alive||n!==detailSequence||attempt!==methodsSequence||scope!==session())return;if(value.orderId!==id)throw Error('支付方式与订单不匹配');if(detailData.value?.payment?.paymentId&&value.paymentId!==detailData.value.payment.paymentId)throw Error('支付记录已变化，请重新查询原订单');methodsError.value='';paymentId.value=value.paymentId||null;methods.value=value.methods.filter(item=>['balance','wechat','alipay','wechat-virtual'].includes(item.provider)&&(item.provider!=='alipay'||rechargeClient()==='h5')).map(item=>{const reason=item.provider==='wechat-virtual'&&item.available?virtualPaymentUnavailableReason():'';return reason?{...item,available:false,reason}:item});balanceCents.value=wallet.balance.amount;if(switchIntent.value)method.value=switchIntent.value.provider;else if(!methods.value.some(item=>item.provider===method.value&&item.available))method.value=methods.value.find(item=>item.available)?.provider||''}
 catch(e){if(alive&&n===detailSequence&&attempt===methodsSequence&&!clearDeniedIdentity(e,scope))methodsError.value=message(e)}finally{clearChangedIdentity(scope);if(alive&&n===detailSequence&&attempt===methodsSequence)methodsAction.value=''}
}
async function payCurrent(){
 if(!canPay.value||!detailData.value||!['balance','wechat','alipay','wechat-virtual'].includes(method.value))return
 if(session()!==currentScope){closeDetails();await load();return}
 const order=detailData.value,n=detailSequence,scope=session(),provider=method.value as PaymentSwitch['provider'];paying.value=true;payError.value='';paymentUnknown.value=true
 try{
  const pending=requiresSwitch.value?{...(switchIntent.value||{paymentId:paymentId.value!,provider,client:rechargeClient()}),phase:'unknown' as const}:null
  if(pending){rememberPaymentSwitch(order.id,pending);switchIntent.value=pending}
  const result=await payOrder(order,{provider,...(pending||provider==='wechat-virtual'?{isCurrent:()=>alive&&n===detailSequence&&scope===session()}:{}),...(pending?{switchPaymentId:pending.paymentId,onSwitch:(state:'waiting'|'settled'|'completed')=>{if(!alive||n!==detailSequence||scope!==session())return;if(state==='settled'){forgetPaymentSwitch(order.id,pending);switchIntent.value=null}else{switchIntent.value={...pending,phase:state==='waiting'?'waiting':'completed'};rememberPaymentSwitch(order.id,switchIntent.value)}}}:{})});if(!alive||n!==detailSequence||scope!==session())return;detailData.value=normalizeOrder(result,order);recoverSwitch(detailData.value);paymentUnknown.value=switchIntent.value?.phase==='completed'||['unknown','processing'].includes(paymentState(detailData.value));await load('mutation');void readMethods()
 }
 catch(e){if(alive&&n===detailSequence&&!clearDeniedIdentity(e,scope))payError.value=message(e)}finally{if(alive&&n===detailSequence){paying.value=false;clearChangedIdentity(scope)}}
}
async function queryCurrent(){
 if(demo.value){await readDetails('query');return}
 if(!detailData.value||paying.value||querying.value)return
 if(session()!==currentScope){closeDetails();await load();return}
 const order=detailData.value,n=detailSequence,scope=session();querying.value=true;payError.value='';methodsSequence++;methodsAction.value='';methods.value=[];paymentId.value=null
 try{const value=await queryOrder(order);if(!alive||n!==detailSequence||scope!==session())return;detailData.value=normalizeOrder(value,order);recoverSwitch(detailData.value,true);paymentUnknown.value=['unknown','processing'].includes(paymentState(detailData.value));await load('mutation');void readMethods()}
 catch(e){if(alive&&n===detailSequence&&!clearDeniedIdentity(e,scope)){paymentUnknown.value=true;payError.value=message(e)}}finally{if(alive&&n===detailSequence){querying.value=false;clearChangedIdentity(scope)}}
}
function toggleDemo(){if(!isClientPreview||packages||paying.value||querying.value||submitting.value||paymentAction.value||confirmation.value||selected.value)return;closeDetails();closeHistory();sequence++;rows.value={items:[],total:0,page:1,pageSize:20};demo.value=!demo.value;page.value=1;currentScope='';void load('mode')}
onLoad(options=>{returnedOrder.value=String(options?.orderId||'');returnedFromCashier=!!returnedOrder.value&&options?.view!=='payment';demo.value=!!isClientPreview&&!packages&&options?.demo==='1';const value=String(options?.status||'all');status.value=filters.some(item=>item.value===value)?value:'all'})
useMaintenanceReload(async()=>{await load('maintenance');if(detailTarget.value)await readDetails('maintenance')},()=>!!loadAction.value||!!paymentAction.value||paying.value||querying.value||submitting.value||!!detailAction.value||!!methodsAction.value||!!historyBusy.value)
 onShow(async()=>{await load();if(!guest.value&&!demo.value&&returnedOrder.value&&/^[A-Za-z0-9_-]{1,64}$/.test(returnedOrder.value)){const id=returnedOrder.value;returnedOrder.value='';openDetails({id},'payment')}});onUnload(()=>{alive=false;sequence++;resetPrivateState()})
return{switchReason,switchIntent,requiresSwitch,payLabel,guest,consumerLogin,methods,methodsAction,methodsError,balanceCents,paying,querying,payError,paymentUnknown,canPay,rechargeOrder,readMethods,payCurrent,queryCurrent,demo,toggleDemo,detailTarget,detailData,detailAction,detailError,panel,method,openDetails,closeDetails,readDetails,switchPanel,states,orderStates,rows,page,loadAction,error,selected,reason,draftRequestKey,submitting,formError,history,historyOrder,historyBusy,historyError,retryHistory,closeHistory,paymentAction,status,filters,load,filter,open,cancel,submit,readHistory,turn,payment,time,money,confirmation,actionError,notice,requestAction,closeAction,confirmAction}
}
export type ConsumerOrdersModel=ReturnType<typeof useConsumerOrders>
