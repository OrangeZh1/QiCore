<script setup lang="ts">
import {ref,computed,onMounted,onBeforeUnmount,watch} from 'vue'
import ClientPasswordInput from './ClientPasswordInput.vue'
import {api,consumerScope,getToken,message} from '../lib/api'
import {runtimeConfig} from '../lib/runtime-config'
type SendAttempt={id:string;deadline:number;unknown:boolean}
const props=defineProps<{hasPassword:boolean;recovery:{scope:string;sends:Map<string,SendAttempt>;bindingTarget:string}}>(),password=ref('')
const emit=defineEmits<{updated:[phone:string|null];unavailable:[cause:{scope:string;reason:string;unauthenticated:boolean}]}>()
const phone=ref(''),verified=ref(''),code=ref(''),action=ref(''),error=ref(''),notice=ref(''),loaded=ref(false),clock=ref(Date.now())
const scopeKey=()=>JSON.stringify([runtimeConfig().apiBase,consumerScope()]),scope=scopeKey()
if(props.recovery.scope!==scope){props.recovery.scope=scope;props.recovery.sends.clear();props.recovery.bindingTarget=''}
const busy=computed(()=>!!action.value),dirty=computed(()=>loaded.value&&(!!phone.value||!!code.value||!!password.value))
const remaining=computed(()=>Math.max(0,Math.ceil(((props.recovery.sends.get(phone.value)?.deadline||0)-clock.value)/1000))),unknown=computed(()=>props.recovery.sends.get(phone.value)?.unknown===true)
const bindingUnknown=computed(()=>!!props.recovery.bindingTarget),blocked=ref(false)
const masked=computed(()=>verified.value.replace(/^(\d{3})\d{4}(\d{4})$/,'$1****$2'))
const canSubmit=computed(()=>loaded.value&&!busy.value&&!blocked.value&&!bindingUnknown.value&&/^1[3-9]\d{9}$/.test(phone.value)&&/^\d{6}$/.test(code.value)&&(!props.hasPassword||!!password.value))
let alive=true
const current=()=>alive&&!blocked.value&&scopeKey()===scope&&props.recovery.scope===scope&&!!getToken()
const timer=setInterval(()=>clock.value=Date.now(),1000)
function unavailable(reason:string,unauthenticated=false){if(!alive||blocked.value)return;blocked.value=true;discard();verified.value='';loaded.value=false;error.value='';notice.value='';action.value='';if(props.recovery.scope===scope){props.recovery.sends.clear();props.recovery.bindingTarget=''}emit('unavailable',{scope,reason,unauthenticated:unauthenticated||!getToken()})}
function active(){if(current())return true;unavailable('登录状态已变化，请重新读取个人资料');return false}
function failed(e:unknown){if(!alive||blocked.value)return true;if(!current()){unavailable('登录状态已变化，请重新读取个人资料');return true}if([401,403].includes((e as any)?.status)){unavailable(message(e),(e as any)?.status===401);return true}return false}
function discard(){phone.value='';code.value='';password.value=''}
watch(phone,()=>{code.value='';password.value='';notice.value='';error.value='';clock.value=Date.now()},{flush:'sync'})
async function load(){
 if(busy.value||!active())return
 action.value='load'
 try{const result=await api<{phone:string|null}>('/phone');if(!active())return;if(result?.phone!==null&&!/^1[3-9]\d{9}$/.test(result?.phone))throw Error('手机号状态未确认，请重新读取');verified.value=result.phone||'';loaded.value=true;error.value='';emit('updated',result.phone)
  if(bindingUnknown.value){if(result.phone===props.recovery.bindingTarget){props.recovery.sends.delete(result.phone);props.recovery.bindingTarget='';discard();notice.value='手机号已验证绑定'}else notice.value='绑定结果尚未确认，请稍后重新读取绑定状态'}
 }catch(e){if(!failed(e))error.value=message(e)}finally{if(alive)action.value=''}
}
async function send(){
 if(busy.value||!loaded.value||bindingUnknown.value||remaining.value&&!unknown.value||!active())return
 error.value='';notice.value='';if(!/^1[3-9]\d{9}$/.test(phone.value)){error.value='请输入有效手机号';return}
 const target=phone.value,saved=props.recovery.sends.get(target),attempt=saved?.unknown?saved:{id:'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const n=Math.random()*16|0;return(c==='x'?n:n&3|8).toString(16)}),deadline:0,unknown:false}
 props.recovery.sends.set(target,{...attempt,unknown:true});action.value=attempt.unknown?'query':'send'
 try{const result=await api<{accepted:boolean;retryAfterSeconds:number}>('/phone/send','POST',{phone:target,requestId:attempt.id});if(!active())return;if(result?.accepted!==true||!Number.isSafeInteger(result.retryAfterSeconds)||result.retryAfterSeconds<0)throw Object.assign(Error('验证码发送结果未确认'),{code:'SMS_RESULT_UNKNOWN'});clock.value=Date.now();props.recovery.sends.set(target,{id:'',deadline:clock.value+result.retryAfterSeconds*1000,unknown:false});if(phone.value===target)notice.value='验证码已发送，请查看手机'}
 catch(e){if(!failed(e)){if(attempt.unknown||['NETWORK_UNKNOWN','SMS_RESULT_UNKNOWN'].includes((e as any)?.code))props.recovery.sends.set(target,{...attempt,unknown:true});else props.recovery.sends.delete(target);if(phone.value===target)error.value=props.recovery.sends.get(target)?.unknown?'验证码发送结果未确认，请查询原发送状态':message(e)}}finally{if(alive)action.value=''}
}
async function bind(){
 if(busy.value||!loaded.value||bindingUnknown.value||!active())return
 error.value='';notice.value=''
 if(!/^1[3-9]\d{9}$/.test(phone.value)||!/^\d{6}$/.test(code.value)){error.value='请输入有效手机号和6位验证码';return}
 if(props.hasPassword&&!password.value){error.value='请输入当前账号密码';return}
 const target=phone.value;props.recovery.bindingTarget=target;action.value='bind'
 try{const result=await api<{bound:boolean;phone:string}>('/phone','PUT',{phone:target,code:code.value,password:password.value});if(!active())return;if(result?.bound!==true||result.phone!==target)throw Object.assign(Error('绑定结果未确认，请重新读取绑定状态'),{code:'NETWORK_UNKNOWN'});props.recovery.bindingTarget='';props.recovery.sends.delete(target);verified.value=target;emit('updated',target);discard();notice.value='手机号已验证绑定';uni.showToast({title:'手机号已验证绑定',icon:'none'})}
 catch(e){if(!failed(e)){if((e as any)?.code==='NETWORK_UNKNOWN'){code.value='';password.value='';error.value='绑定结果未确认，请重新读取绑定状态'}else{props.recovery.bindingTarget='';error.value=message(e)}}}finally{if(alive)action.value=''}
}
defineExpose({busy,dirty,discard,action,canSubmit,bind,verified})
onMounted(load)
onBeforeUnmount(()=>{alive=false;discard();verified.value='';clearInterval(timer)})
</script>
<template><view class="phone-binding">
 <view v-if="action==='load'&&!error&&!loaded&&!bindingUnknown" class="binding-hint" role="status">正在读取绑定状态…</view>
 <template v-if="loaded"><view class="binding-hint">{{verified?'验证新手机号后完成更换':'验证手机号后完成绑定'}}，用于登录和找回密码。</view><view v-if="verified" class="binding-row"><text class="binding-label">当前手机号</text><text class="binding-number">{{masked}}</text><text class="binding-badge">已绑定</text></view><view class="binding-row"><text class="binding-label">{{verified?'新手机号':'手机号'}}</text><input v-model="phone" aria-label="手机号" type="number" :maxlength="11" :disabled="busy||bindingUnknown" placeholder="请输入11位手机号"/></view><view class="binding-row phone-code"><text class="binding-label">验证码</text><input v-model="code" aria-label="绑定验证码" type="number" :maxlength="6" :disabled="busy||bindingUnknown" placeholder="6位验证码"/><button role="button" :loading="action==='send'||action==='query'" :aria-disabled="busy||bindingUnknown||remaining>0&&!unknown" :disabled="busy||bindingUnknown||remaining>0&&!unknown" @click="send">{{action==='send'?'获取验证码':unknown?'查询发送状态':remaining?remaining+'秒后重发':'获取验证码'}}</button></view><view v-if="hasPassword" class="binding-row binding-password"><text class="binding-label">当前密码</text><ClientPasswordInput v-model="password" label="当前账号密码" placeholder="请输入当前密码" :disabled="busy||bindingUnknown"/></view></template>
 <view v-if="error" class="binding-error" role="alert">{{error}}</view><view v-if="notice" class="binding-hint" role="status">{{notice}}</view>
 <button v-if="bindingUnknown&&action!=='bind'||!loaded&&error" role="button" class="binding-submit" :loading="action==='load'" :aria-disabled="busy" :disabled="busy" @click="load">{{bindingUnknown?'重新读取绑定状态':'重新读取'}}</button>
</view></template>
<style scoped>
.binding-hint{font-size:12px;line-height:1.8;color:var(--client-muted,#8290a4);margin-bottom:12px}.binding-row{display:flex;align-items:center;gap:12px;min-height:58px}.binding-row+.binding-row{border-top:1px solid #f0f2f5}.binding-label{flex-shrink:0;width:70px;font-size:13px}.phone-binding input{box-sizing:border-box;flex:1;min-width:0;width:0;height:46px;margin:0;padding:0;border:0;border-radius:0;background:transparent;font-size:14px}.binding-number{flex:1;min-width:0;font-size:14px;color:var(--client-muted,#8290a4)}.binding-badge{flex-shrink:0;padding:3px 5px;border-radius:4px;font-size:10px;color:#8995a3;background:#f2f5f7}.phone-binding button{box-sizing:border-box;border:0;margin:0;font:inherit;line-height:1.5}.phone-binding button::after{border:0}.phone-code{gap:8px}.phone-code button{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:112px;min-width:112px;height:44px;font-size:12px;white-space:nowrap;padding:10px 0 10px 8px;border-left:1px solid #eef0f3;background:transparent;color:var(--client-primary,#3479f6)}.binding-submit{width:100%;min-height:46px;margin-top:20px!important;border-radius:12px;background:var(--client-primary,#3479f6);color:#fff;font-size:15px!important}.binding-submit[disabled]{background:var(--client-primary-disabled,#dce7fa);color:#fff;opacity:1}.binding-error{color:#b84039;font-size:14px;line-height:1.7;margin-top:12px}.binding-password :deep(.password-input){font-size:14px}.binding-password :deep(.password-toggle){min-width:36px;width:36px}@media(max-width:350px){.binding-label{width:58px}.binding-row{gap:6px}.phone-code button{width:104px;min-width:104px;font-size:11px}.phone-binding input{font-size:13px}}
</style>
