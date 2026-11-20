<script setup lang="ts">
import {useMaintenanceReload} from '../../lib/maintenance'
import ClientNavigation from '../../components/ClientNavigation.vue'
import ClientPageState from '../../components/ClientPageState.vue'
import {clientThemeStyle} from '../../lib/client-theme'
import {ref,reactive,computed,getCurrentInstance,onMounted,watch} from 'vue'
import {onShow,onUnload} from '@dcloudio/uni-app'
import {api,ensureSession,getToken,identityScope,isH5,isClientPreview,isDevelopmentLogin,isSignedOut,login as developmentLogin,loginWechat,loginPreview,message,openLogin,signOut,startOfficialLogin} from '../../lib/api'
import ClientPasswordInput from '../../components/ClientPasswordInput.vue'
import ClientDialog from '../../components/ClientDialog.vue'
import ConsumerPhoneBinding from '../../components/ConsumerPhoneBinding.vue'
import {runtimeConfig,clientImageUrl} from '../../lib/runtime-config'
import {profileAvatar} from '../../lib/profile-avatar'
import {frameworkAsset} from '@qicore/application-sdk/browser/decoration-framework.mjs'

type Profile={id:string;account?:string|null;accountKind?:'wechat'|'account';nickname:string;avatar:string|null;defaultAvatar?:string|null;memberNumber:string|null;phone:string;email:string;gender:string;version:number;hasPassword:boolean}
const profile=ref<Profile|null>(null),form=reactive({nickname:'',avatar:null as string|null,gender:'unknown'})
const baseline=ref(''),action=ref(''),error=ref(''),conflict=ref(false),guest=ref(false)
const passwordOpen=ref(false),genderOpen=ref(false),passwordError=ref(''),password=reactive({oldPassword:'',password:'',confirmation:''})
const confirmingPassword=ref(false)
const phoneOpen=ref(false),phoneBinding=ref<InstanceType<typeof ConsumerPhoneBinding>|null>(null),logoutOpen=ref(false),canWechat=ref(false),developerOpen=ref(false)
const nativePhonePassword=ref(''),nativePhoneError=ref(''),nativePhoneNotice=ref(''),nativePhoneUnknown=ref(false)
const accountLabel=computed(()=>profile.value?.account||(profile.value?.accountKind==='wechat'?'微信账号':''))
const verifiedPhone=ref<string|null|undefined>(undefined),phoneReading=ref(false),phoneError=ref('')
const phoneRecovery=reactive({scope:'',sends:new Map<string,{id:string;deadline:number;unknown:boolean}>(),bindingTarget:''})
const phoneLabel=computed(()=>phoneReading.value?'读取中…':phoneError.value?'读取失败，点击重试':verifiedPhone.value===undefined?'查看绑定状态':verifiedPhone.value?verifiedPhone.value.replace(/^(\d{3})\d{4}(\d{4})$/,'$1****$2'):'未绑定')
const savedIdentity=uni.getStorageSync('zjz-identity')||{},tenant=ref(savedIdentity.tenantId||'demo'),user=ref(savedIdentity.userId||'developer')
const locked=computed(()=>!!action.value||!!phoneBinding.value?.busy)
const profileDirty=computed(()=>!!baseline.value&&JSON.stringify(form)!==baseline.value)
const passwordDirty=computed(()=>!!password.oldPassword||!!password.password||!!password.confirmation)
const dirty=computed(()=>profileDirty.value||passwordDirty.value||!!phoneBinding.value?.dirty)
const genders=[{value:'unknown',label:'保密'},{value:'male',label:'男'},{value:'female',label:'女'}]
const genderIndex=computed(()=>Math.max(0,genders.findIndex(item=>item.value===form.gender)))
const component=getCurrentInstance()?.proxy,asset=(name:string)=>(isH5?'/h5-assets':'')+frameworkAsset(name,true)
let alive=true,token='',scope='',sequence=0,phoneSequence=0,removeGuard:(()=>void)|undefined
function current(n=sequence){return alive&&n===sequence&&getToken()===token&&identityScope()===scope}
function clearPhoneRecovery(){phoneRecovery.scope='';phoneRecovery.sends.clear();phoneRecovery.bindingTarget='';nativePhonePassword.value='';nativePhoneError.value='';nativePhoneNotice.value='';nativePhoneUnknown.value=false}
function clearProfile(){profile.value=null;baseline.value='';Object.assign(form,{nickname:'',avatar:null,gender:'unknown'});conflict.value=false;clearPassword();genderOpen.value=false;phoneOpen.value=false;logoutOpen.value=false;phoneBinding.value?.discard();clearPhoneRecovery();phoneSequence++;phoneReading.value=false;verifiedPhone.value=undefined;phoneError.value=''}
function unavailable(reason='',unauthenticated=false){sequence++;clearProfile();action.value='';guest.value=unauthenticated||!getToken();error.value=guest.value?'':reason}
function failed(e:unknown,n:number){if(!alive||n!==sequence)return true;if(!current(n)){unavailable('登录状态已变化，请重新读取个人资料');return true}if([401,403].includes((e as any)?.status)){unavailable(message(e),(e as any)?.status===401);return true}return false}
function fill(value:Profile){profile.value=value;Object.assign(form,{nickname:value.nickname,avatar:value.avatar,gender:value.gender||'unknown'});baseline.value=JSON.stringify(form);conflict.value=false}
async function loadPhone(n:number){const own=++phoneSequence;phoneReading.value=true;phoneError.value='';verifiedPhone.value=undefined;try{const value=await api<{phone:string|null}>('/phone');if(!alive||n!==sequence||own!==phoneSequence)return;if(current(n))verifiedPhone.value=value.phone;else unavailable('登录状态已变化，请重新读取个人资料')}catch(e){if(own===phoneSequence&&!failed(e,n))phoneError.value=message(e)}finally{if(alive&&n===sequence&&own===phoneSequence)phoneReading.value=false}}
function phoneUpdated(value:string|null){phoneSequence++;phoneReading.value=false;phoneError.value='';verifiedPhone.value=value}
function phoneUnavailable(cause:{scope:string;reason:string;unauthenticated:boolean}){if(alive&&phoneOpen.value&&cause.scope===phoneRecovery.scope)unavailable(cause.reason,cause.unauthenticated)}
async function load(source='initial'){
 if(locked.value)return
 const n=++sequence
 action.value=source;if(source!=='reload')error.value='';guest.value=false;token=getToken();scope=identityScope()
 if(!getToken()&&(isH5&&!isClientPreview||isSignedOut())){unavailable();return}
 try{await ensureSession({redirect:false});if(!alive||n!==sequence)return;token=getToken();scope=identityScope();const value=await api<Profile>('/profile');if(!alive||n!==sequence)return;if(current(n)){if(source==='maintenance'&&dirty.value){profile.value=value;conflict.value=true}else fill(value);error.value='';if(source!=='maintenance'||!phoneBinding.value?.dirty)void loadPhone(n)}else unavailable('登录状态已变化，请重新读取个人资料')}
 catch(e){if(!failed(e,n))error.value=message(e)}
 finally{if(alive&&n===sequence)action.value=''}
}
async function save(){
 if(locked.value||!profile.value||!profileDirty.value||conflict.value)return
 if(!current()){unavailable();await load();return}
 const n=sequence;action.value='save';error.value=''
 try{const value=await api<Profile>('/profile','PUT',{version:profile.value.version,...form,nickname:form.nickname.trim()});if(current(n)){fill({...profile.value,...value});uni.showToast({title:'资料已保存',icon:'success'})}else if(alive&&n===sequence)unavailable('登录状态已变化，请重新读取个人资料')}
 catch(e){if(!failed(e,n)){error.value=message(e);conflict.value=(e as any)?.code==='PROFILE_CONFLICT'}}
 finally{if(alive&&n===sequence)action.value=''}
}
async function allowLeave(){
 if(locked.value||confirmingPassword.value)return false
 if(!dirty.value)return true
 const n=sequence;confirmingPassword.value=true
 try{const result=await uni.showModal({title:'放弃未保存的修改？',content:'离开后，本次修改不会保存。',confirmText:'放弃修改',cancelText:'继续编辑'});if(!result.confirm||!current(n))return false;if(baseline.value)Object.assign(form,JSON.parse(baseline.value));clearPassword();phoneBinding.value?.discard();phoneOpen.value=false;return true}finally{confirmingPassword.value=false}
}
function clearPassword(){password.oldPassword='';password.password='';password.confirmation='';passwordError.value='';passwordOpen.value=false}
async function togglePassword(){
 if(locked.value||confirmingPassword.value)return
 if(passwordOpen.value&&passwordDirty.value){confirmingPassword.value=true;try{const result=await uni.showModal({title:'放弃未保存的密码？',confirmText:'放弃修改',cancelText:'继续编辑'});if(!result.confirm||!alive)return}finally{confirmingPassword.value=false}}
 if(passwordOpen.value)clearPassword();else passwordOpen.value=true
}
async function savePassword(){
 if(locked.value||!profile.value||profileDirty.value)return
 passwordError.value=''
 if(!current()){unavailable();await load();return}
 if(profile.value.hasPassword&&!password.oldPassword){passwordError.value='请输入原密码';return}
 if(password.password.length<6||password.password.length>128){passwordError.value='新密码须为 6–128 个字符';return}
 if(password.password!==password.confirmation){passwordError.value='两次输入的密码不一致';return}
 const n=sequence;action.value='password'
 try{
  await api('/password','PUT',{oldPassword:profile.value.hasPassword?password.oldPassword:'',password:password.password})
  if(!current(n)){if(alive&&n===sequence)unavailable('登录状态已变化，请重新读取个人资料');return}
  signOut();unavailable()
  uni.showToast({title:'密码已更新，请重新登录',icon:'none'})
  if(isH5)uni.reLaunch({url:'/pages/login/index?returnPath=/personal'})
 }catch(e){if(!failed(e,n))passwordError.value=message(e)}
 finally{if(alive&&n===sequence)action.value=''}
}
async function leave(){if(await allowLeave()){if(getCurrentPages().length>1)uni.navigateBack();else uni.reLaunch({url:'/pages/profile/index'})}}
async function login(kind='login'){
 if(locked.value||!await allowLeave()||locked.value)return
 if(kind==='login'){openLogin();return}
 action.value=kind;error.value=''
 try{const result=kind==='preview'?await loginPreview():kind==='development'?await developmentLogin(tenant.value.trim(),user.value.trim()):await loginWechat();if(!alive||getToken()!==result.token)return;unavailable();developerOpen.value=false;await load()}
 catch(e){if(alive)error.value=message(e)}finally{if(alive)action.value=''}
}
async function askLogout(){if(!current()){await reload();return}if(await allowLeave()){error.value='';logoutOpen.value=true}}
async function logout(){
 if(locked.value||!logoutOpen.value||!current())return
 const n=sequence,oldToken=token;action.value='logout';error.value=''
 try{try{await api('/session','DELETE')}catch(e){if((e as any)?.status!==401)throw e}if(getToken()&&getToken()!==oldToken)return;signOut();if(alive&&n===sequence)unavailable()}
 catch(e){if(current(n))error.value=message(e)}finally{if(alive&&n===sequence)action.value=''}
}
async function connectWechat(){if(!canWechat.value||!current()||!await allowLeave()||locked.value)return;action.value='wechat';error.value='';try{await startOfficialLogin('/personal')}catch(e){if(current())error.value=message(e)}finally{if(alive)action.value=''}}
function openPhone(){if(locked.value||passwordOpen.value||genderOpen.value)return;if(!current()){unavailable();void load();return}phoneSequence++;phoneReading.value=false;nativePhonePassword.value='';nativePhoneError.value='';nativePhoneNotice.value='';phoneOpen.value=true}
async function closePhone(){if(locked.value||confirmingPassword.value)return;const n=sequence,binding=phoneBinding.value;if(binding?.dirty){confirmingPassword.value=true;try{const result=await uni.showModal({title:'放弃未保存的手机号？',confirmText:'放弃修改',cancelText:'继续编辑'});if(!result.confirm||!current(n)||binding!==phoneBinding.value)return}finally{confirmingPassword.value=false}}phoneBinding.value?.discard();nativePhonePassword.value='';phoneOpen.value=false}
async function bindWechatPhone(event:{detail?:{code?:string;errMsg?:string}}){
 if(isH5||locked.value||!phoneOpen.value||nativePhoneUnknown.value||!current()||!profile.value)return
 nativePhoneError.value='';nativePhoneNotice.value=''
 const code=event.detail?.code;if(!code)return
 if(profile.value.hasPassword&&!nativePhonePassword.value){nativePhoneError.value='请输入当前账号密码';return}
 const n=sequence;action.value='phone'
 try{const result=await api<{bound:boolean;phone:string}>('/phone/wechat','PUT',{code,...(profile.value.hasPassword?{password:nativePhonePassword.value}:{})});if(!current(n))return;if(result.bound!==true||!/^1[3-9]\d{9}$/.test(result.phone))throw Object.assign(Error('绑定结果未确认'),{code:'NETWORK_UNKNOWN'});phoneUpdated(result.phone);nativePhoneNotice.value='手机号已验证绑定'}
 catch(e){if(current(n)&&(e as any)?.code==='WECHAT_LOGIN_REQUIRED')nativePhoneError.value=message(e);else if(!failed(e,n)){nativePhoneUnknown.value=['NETWORK_UNKNOWN','API_RESPONSE_INVALID'].includes((e as any)?.code)||(e as any)?.status===408||!(e as any)?.status||(e as any)?.status>=500;nativePhoneError.value=nativePhoneUnknown.value?'绑定结果未确认，请重新读取当前绑定状态':message(e)}}
 finally{nativePhonePassword.value='';if(alive&&n===sequence)action.value=''}
}
async function readWechatPhone(){
 if(isH5||locked.value||!phoneOpen.value||!current())return
 const n=sequence;action.value='phone-read';nativePhoneError.value=''
 try{const result=await api<{phone:string|null}>('/phone');if(!current(n))return;if(result.phone!==null&&!/^1[3-9]\d{9}$/.test(result.phone))throw Error('手机号状态未确认');phoneUpdated(result.phone);nativePhoneUnknown.value=false;nativePhoneNotice.value=result.phone?'当前已绑定号码：'+result.phone.replace(/^(\d{3})\d{4}(\d{4})$/,'$1****$2'):'当前尚未绑定手机号，可重新点击微信授权'}
 catch(e){if(!failed(e,n))nativePhoneError.value=message(e)}finally{if(alive&&n===sequence)action.value=''}
}
async function reload(){if(await allowLeave())await load('reload')}
function openGender(){if(!locked.value&&!passwordOpen.value&&!phoneOpen.value)genderOpen.value=true}
function gender(value:string){if(action.value||!genders.some(item=>item.value===value))return;form.gender=value;genderOpen.value=false}
function closeDialog(){if(locked.value)return;if(passwordOpen.value)void togglePassword();else genderOpen.value=false}
async function avatar(){
 if(locked.value||!profile.value)return
 const n=sequence;action.value='avatar';error.value=''
 try{const selected=await uni.chooseImage({count:1,sizeType:['compressed'],sourceType:['album','camera']});if(!current(n))return;const value=await profileAvatar(selected.tempFilePaths[0]!,component);if(current(n))form.avatar=value}
 catch(e){if(current(n)&&!String((e as any)?.errMsg||'').includes('cancel'))error.value=message(e)}
 finally{if(alive&&n===sequence)action.value=''}
}
async function chooseWechatAvatar(event:{detail?:{avatarUrl?:string}}){
 const path=event.detail?.avatarUrl;if(isH5||!path||locked.value||!profile.value||!current())return
 const n=sequence;action.value='avatar';error.value=''
 try{const value=await profileAvatar(path,component);if(current(n))form.avatar=value}catch(e){if(current(n))error.value=message(e)}finally{if(alive&&n===sequence)action.value=''}
}
function nicknameChanged(event:Event|{detail?:{value?:string}}){const value=(event as {detail?:{value?:string}}).detail?.value;if(!locked.value&&typeof value==='string')form.nickname=value}
function unload(event:BeforeUnloadEvent){if(dirty.value||locked.value){event.preventDefault();event.returnValue=''}}
// MP's native back/close gesture does not go through the H5 router.
watch(()=>dirty.value||locked.value,value=>{if(!isH5){if(value)uni.enableAlertBeforeUnload?.({message:'资料尚未保存，确定离开？'});else uni.disableAlertBeforeUnload?.()}})
useMaintenanceReload(()=>load('maintenance'),()=>locked.value)
onShow(()=>{if(!profile.value||!current()){unavailable();void load()}})
onMounted(()=>{if(isH5){canWechat.value=!!(runtimeConfig() as any).officialLogin&&/MicroMessenger/i.test(navigator.userAgent);window.addEventListener('beforeunload',unload);const router=(getApp() as any).$vm?.$router;if(router)removeGuard=router.beforeEach((to:any,from:any)=>from.path.endsWith('/personal')&&to.fullPath!==from.fullPath?allowLeave():true)}})
onUnload(()=>{alive=false;sequence++;clearPassword();clearPhoneRecovery();phoneOpen.value=false;genderOpen.value=false;removeGuard?.();if(isH5)window.removeEventListener('beforeunload',unload);else uni.disableAlertBeforeUnload?.()})
</script>

<template><page-meta :page-style="clientThemeStyle"/>
<!-- #ifdef MP-WEIXIN -->
<scroll-view class="client-page-scroll" scroll-y enhanced :show-scrollbar="false">
<!-- #endif -->
 <view class="personal-page">
  <view v-if="isH5" class="personal-nav-shell"><ClientNavigation title="个人资料" back :back-action="leave" :back-disabled="locked"/></view>
  <view v-if="(action==='initial'||action==='reload')&&!profile&&!error" class="profile-state" role="status">正在读取个人资料…</view>
  <ClientPageState v-if="error&&!profile&&!guest" kind="error" title="暂时无法读取个人资料" :description="error" action-label="重新读取" :loading="action==='reload'" :disabled="locked" @action="reload"/>
  <view v-else-if="error&&!guest" class="profile-error" role="alert">{{error}}<button role="button" v-if="conflict" :loading="action==='reload'" :aria-disabled="locked" :disabled="locked" @click="reload">重新读取</button></view>
  <ClientPageState v-if="guest" title="登录后管理个人资料" description="查看和编辑头像、昵称及账户信息" action-label="去登录" :loading="action==='login'" :disabled="locked" @action="login()"><button v-if="isClientPreview" role="button" :loading="action==='preview'" :disabled="locked" @click="login('preview')">继续开发预览</button></ClientPageState>
  <template v-else-if="profile">
   <view class="profile-card">
    <view class="avatar-row"><view class="avatar-copy"><text class="field-label">头像</text><text class="field-hint">设置喜欢的头像</text></view><button role="button" class="avatar-button" aria-label="修改头像" :disabled="locked" :open-type="isH5?undefined:'chooseAvatar'" @chooseavatar="chooseWechatAvatar" @click="isH5&&avatar()"><image class="avatar-image" :src="clientImageUrl(form.avatar||profile.defaultAvatar)||asset('avatar.png')" mode="aspectFill"/><view class="avatar-edit"><image v-if="action!=='avatar'" :src="asset('icons/camera.svg')" mode="aspectFit"/><view v-else class="avatar-spinner spinning"/></view></button></view>
    <view v-if="accountLabel" class="profile-row"><text class="field-label">账号</text><text class="field-value readonly">{{accountLabel}}</text></view>
    <view v-if="profile.memberNumber" class="profile-row"><text class="field-label">会员编号</text><text class="field-value readonly">{{profile.memberNumber}}</text></view>
    <view class="profile-row"><text class="field-label">昵称</text><input class="profile-input" aria-label="昵称" :type="isH5?'text':'nickname'" v-model="form.nickname" @blur="nicknameChanged" :disabled="locked" :maxlength="32" placeholder="填写昵称"/></view>
    <button role="button" tabindex="0" class="profile-row profile-control" aria-label="性别" aria-haspopup="dialog" :disabled="locked" @click="openGender" @keydown.enter.prevent="openGender"><text class="field-label">性别</text><text class="field-value action-value">{{genders[genderIndex]?.label}}</text></button>
    <button role="button" aria-label="手机号" class="profile-row profile-control" :disabled="locked" aria-haspopup="dialog" @click="openPhone"><text class="field-label">手机号</text><text class="field-value action-value">{{phoneLabel}}</text></button>
    <button role="button" class="profile-row profile-control password-entry" tabindex="0" aria-haspopup="dialog" :disabled="locked" @click="togglePassword" @keydown.enter.prevent="togglePassword"><text class="field-label">登录密码</text><text class="field-value password-link">{{profile.hasPassword?'修改密码':'设置密码'}}</text></button>

   </view>
   <button v-if="canWechat" role="button" class="account-action" :loading="action==='wechat'" :disabled="locked" @click="connectWechat">微信授权绑定</button>
   <button role="button" class="account-action" :disabled="locked" @click="askLogout">退出登录</button>
   <view class="profile-footer"><button role="button" class="cancel-button" :disabled="locked" @click="leave">取消</button><button role="button" class="save-button" :loading="action==='save'" :disabled="locked||!profileDirty||conflict" @click="save">保存资料</button></view>
   <ClientDialog v-if="passwordOpen||genderOpen" :title="passwordOpen?(profile.hasPassword?'修改密码':'设置密码'):'选择性别'" :busy="locked" :suspended="confirmingPassword" @close="closeDialog">
    <view v-if="passwordOpen" class="password-editor">
     <view v-if="profile.hasPassword" class="password-row"><text class="field-label">原密码</text><ClientPasswordInput v-model="password.oldPassword" label="原密码" placeholder="请输入原密码" autocomplete="current-password" :disabled="locked"/></view>
     <view class="password-row"><text class="field-label">新密码</text><ClientPasswordInput v-model="password.password" label="新密码" placeholder="请输入新密码" autocomplete="new-password" :disabled="locked"/></view>
     <view class="password-row"><text class="field-label">确认密码</text><ClientPasswordInput v-model="password.confirmation" label="确认密码" placeholder="再次输入新密码" autocomplete="new-password" :disabled="locked" @confirm="savePassword"/></view>
     <view v-if="passwordError" class="password-error" role="alert">{{passwordError}}</view>
     <view class="password-hint">{{profileDirty?'请先关闭弹窗并保存个人资料，再修改密码。':'密码保存成功后需要重新登录。'}}</view>
    </view>
    <view v-else class="gender-options" role="group" aria-label="性别选项"><button v-for="item in genders" :key="item.value" role="button" tabindex="0" class="gender-option" :class="{chosen:form.gender===item.value}" :aria-pressed="form.gender===item.value" :disabled="locked" @click="gender(item.value)" @keydown.enter.prevent="gender(item.value)"><text>{{item.label}}</text><view class="gender-check" aria-hidden="true"><text v-if="form.gender===item.value">✓</text></view></button></view>
    <template #footer>
     <view v-if="passwordOpen" class="password-actions"><button role="button" tabindex="0" class="cancel-button" :disabled="locked" @click="togglePassword">取消</button><button role="button" tabindex="0" class="save-button" :loading="action==='password'" :disabled="locked||profileDirty||!password.password||!password.confirmation" @click="savePassword">保存密码</button></view>
     <button v-else role="button" tabindex="0" class="gender-cancel cancel-button" @click="closeDialog">取消</button>
    </template>
   </ClientDialog>
   <ClientDialog v-if="phoneOpen&&isH5" title="手机号" :busy="locked" :suspended="confirmingPassword" @close="closePhone"><ConsumerPhoneBinding ref="phoneBinding" :has-password="profile.hasPassword" :recovery="phoneRecovery" @updated="phoneUpdated" @unavailable="phoneUnavailable"/><template #footer><view class="password-actions"><button role="button" class="cancel-button" :disabled="locked" @click="closePhone">取消</button><button role="button" class="save-button" :loading="phoneBinding?.action==='bind'" :disabled="locked||!phoneBinding?.canSubmit" @click="phoneBinding?.bind()">{{phoneBinding?.verified?'确认更换':'验证绑定'}}</button></view></template></ClientDialog>
   <ClientDialog v-if="phoneOpen&&!isH5" title="手机号" :busy="locked" @close="closePhone">
    <view class="password-hint">主动授权后，由微信验证手机号并绑定到当前账号。</view>
    <view v-if="profile.hasPassword&&!nativePhoneUnknown" class="password-row"><text class="field-label">当前密码</text><ClientPasswordInput v-model="nativePhonePassword" label="当前账号密码" placeholder="请输入当前密码" :disabled="locked"/></view>
    <view v-if="nativePhoneError" class="password-error" role="alert">{{nativePhoneError}}</view><view v-if="nativePhoneNotice" class="password-hint" role="status">{{nativePhoneNotice}}</view>
    <template #footer><view class="password-actions"><button role="button" class="cancel-button" :disabled="locked" @click="closePhone">关闭</button><button v-if="nativePhoneUnknown" role="button" class="save-button" :loading="action==='phone-read'" :disabled="locked" @click="readWechatPhone">重新读取绑定状态</button><button v-else role="button" class="save-button" open-type="getPhoneNumber" :loading="action==='phone'" :disabled="locked||profile.hasPassword&&!nativePhonePassword" @getphonenumber="bindWechatPhone">微信授权手机号</button></view></template>
   </ClientDialog>
  </template>
  <view v-if="isDevelopmentLogin" class="development-tools"><button role="button" :disabled="locked" @click="developerOpen=!developerOpen">开发测试身份</button><view v-if="developerOpen"><text class="profile-hint">仅用于开发环境隔离测试</text><input v-model="tenant" aria-label="测试租户编号" placeholder="测试租户编号" :disabled="locked"/><input v-model="user" aria-label="测试用户编号" placeholder="测试用户编号" :disabled="locked"/><button role="button" :loading="action==='development'" :disabled="locked||!tenant.trim()||!user.trim()" @click="login('development')">切换开发身份</button></view></view>
  <ClientDialog v-if="logoutOpen" title="退出登录？" :busy="locked" @close="logoutOpen=false"><view class="profile-hint">退出后，查看账户信息需要重新登录。</view><view v-if="error" class="password-error" role="alert">{{error}}</view><template #footer><view class="password-actions"><button role="button" class="cancel-button" :disabled="locked" @click="logoutOpen=false">取消</button><button role="button" class="save-button" :loading="action==='logout'" :disabled="locked" @click="logout">确认退出</button></view></template></ClientDialog>
  <!-- #ifndef H5 -->
  <canvas canvas-id="profile-avatar" id="profile-avatar" class="avatar-canvas"/>
  <!-- #endif -->
 </view>

<!-- #ifdef MP-WEIXIN -->
</scroll-view>
<!-- #endif -->
</template>

<style scoped>
.personal-nav-shell{margin:0 calc(-1 * var(--client-page-gutter,10px))}
.personal-page{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;box-sizing:border-box;min-height:100dvh;padding:0 var(--client-page-gutter, 10px) calc(170rpx + env(safe-area-inset-bottom));background:var(--client-page-background, #f3f9ff);color:var(--client-text, #1e293b)}.personal-page button{box-sizing:border-box;border:0;margin:0;font:inherit;line-height:1.5}.personal-page button::after{border:0}.personal-page button[disabled]{opacity:1}.personal-nav{display:flex;align-items:center;justify-content:space-between;height:104rpx;margin:0 -28rpx;padding:0 20rpx;background:var(--client-surface,#ffffff);color:var(--client-text,#1e293b)}.nav-title{font-size:32rpx;font-weight:600}.nav-back,.nav-space{display:flex;align-items:center;justify-content:center;width:64rpx;height:72rpx;padding:12rpx;background:transparent}.nav-back image{width:40rpx;height:40rpx;filter:var(--client-navigation-icon-filter,brightness(0) invert(1))}.profile-card{overflow:hidden;padding:0 30rpx;background:var(--client-surface, #ffffff);border-radius:24rpx;margin-top:14rpx}.avatar-row{display:flex;align-items:center;gap:20rpx;padding:32rpx 0}.avatar-copy{display:flex;flex:1;flex-direction:column;gap:12rpx}.field-label{flex-shrink:0;min-width:126rpx;font-size:28rpx}.field-hint{font-size:23rpx;color:#929dad}.avatar-button{position:relative;flex-shrink:0;width:116rpx;height:116rpx;padding:0;background:transparent;overflow:visible}.avatar-image{width:116rpx;height:116rpx;border-radius:50%;background:var(--client-primary-soft, #edf4ff)}.avatar-edit{position:absolute;right:-2rpx;bottom:-2rpx;display:flex;align-items:center;justify-content:center;width:38rpx;height:38rpx;border:4rpx solid #fff;border-radius:50%;background:var(--client-primary-soft, #edf4ff)}.avatar-edit image{width:24rpx;height:24rpx}.avatar-spinner{width:19rpx;height:19rpx;border:3rpx solid #b4c9ee;border-top-color:var(--client-primary, #2563eb);border-radius:50%}.profile-row{display:flex;align-items:center;gap:20rpx;min-height:112rpx;border-top:1rpx solid #f0f2f6}.field-value{flex:1;min-width:0;text-align:right;overflow-wrap:anywhere;font-size:27rpx;line-height:1.6}.readonly{color:#8b98aa}.profile-input{box-sizing:border-box;min-width:0;width:0;flex:1;height:110rpx;padding:0;border:0;border-radius:0;text-align:right;background:transparent;font-size:27rpx;color:var(--client-text, #1e293b)}.profile-hint{margin:22rpx 8rpx;font-size:23rpx;line-height:1.7;color:#929dad}.profile-footer{position:fixed;box-sizing:border-box;left:0;right:0;bottom:0;max-width:480px;margin:auto;display:flex;gap:24rpx;padding:24rpx var(--client-page-gutter, 10px) calc(24rpx + env(safe-area-inset-bottom));background:var(--client-background,#f6f8fc);border-top:0}.profile-footer button{display:flex;align-items:center;justify-content:center;height:88rpx;border-radius:16rpx;font-size:29rpx}.cancel-button{flex:1;background:#f1f4f9;color:#64748b}.save-button{flex:2;background:var(--client-primary, #2563eb);color:#fff}.save-button[disabled]{background:var(--client-primary-disabled, #dce7fa);color:#fff}.profile-state{padding:80rpx 24rpx;text-align:center;color:#7c8ba0;font-size:27rpx;line-height:1.8}.profile-state button{margin-top:28rpx}.profile-error{padding:24rpx;margin:16rpx 0;border-radius:16rpx;background:#fff0ef;color:#b84039;font-size:25rpx;line-height:1.7}.profile-error button{background:transparent;color:#b84039;text-align:left;padding:12rpx 0 0}.avatar-canvas{position:fixed;left:-1000px;top:-1000px;width:256px;height:256px;pointer-events:none}.spinning{animation:profile-spin 1s linear infinite}@keyframes profile-spin{to{transform:rotate(360deg)}}
.profile-control{width:100%;padding:0;background:transparent;border-radius:0!important;text-align:left!important;border-top:1rpx solid #f0f2f6!important}.password-link,.action-value{color:var(--client-primary, #2563eb)}.password-editor{padding:0}.password-row{display:block;margin-bottom:16px}.password-row .field-label{display:block;min-width:0;margin-bottom:8px;font-size:14px;font-weight:500;line-height:20px;color:#465d7d}.password-row :deep(.password-control){box-sizing:border-box;display:flex;align-items:center;width:100%;min-height:48px;padding:0 12px;border:1px solid #e3e9f2;border-radius:12px;background:#f7f9fc}.password-row :deep(.password-control:focus-within){border-color:#8bb1fb;background:var(--client-surface, #ffffff)}.password-row :deep(.password-input){height:46px;font-size:16px;line-height:24px}.password-row :deep(.password-toggle){width:40px;min-width:40px;height:44px;min-height:44px}.password-hint{font-size:12px;color:#8390a3;line-height:1.6;margin-top:4px}.password-error{color:#b84039;font-size:14px;line-height:1.6;margin:0 0 12px}.password-actions{display:flex;gap:0;width:100%}.password-actions button,.gender-cancel{display:flex;align-items:center;justify-content:center;flex:1;width:auto;min-width:0;height:52px;min-height:52px;padding:0 16px;border-radius:0!important;font-size:16px!important;font-weight:500!important;background:var(--client-surface, #ffffff);color:#607088;line-height:1.5}.password-actions button{flex:0 0 50%;width:50%}.password-actions .save-button{color:var(--client-primary, #2563eb);border-left:1px solid #edf0f5}.password-actions .save-button[disabled]{background:var(--client-surface, #ffffff);color:#a5b4cc}.gender-cancel{width:100%}.gender-options{display:flex;flex-direction:column;gap:0}.gender-option{position:relative;display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;padding:0 40px;border-radius:0!important;background:transparent;color:#465d7d;font-size:16px!important;text-align:center}.gender-option+.gender-option{border-top:1px solid #f0f2f6}.gender-option.chosen{background:#f6f9ff;color:var(--client-primary, #2563eb);font-weight:600!important}.gender-check{position:absolute;right:12px;top:0;bottom:0;display:flex;align-items:center;justify-content:center;width:24px;font-size:20px;font-weight:600}.profile-control:focus-visible,.gender-option:focus-visible{outline:2px solid var(--client-primary-border, #9bbcff);outline-offset:-2px}
</style>
<style scoped>
.profile-error button{display:flex;align-items:center;height:36px;min-height:36px}
.account-action{display:flex;align-items:center;justify-content:center;width:100%;min-height:92rpx;padding:20rpx;margin-top:24rpx!important;border-radius:20rpx;background:var(--client-surface,#fff);color:var(--client-primary,#3479f6);font-size:28rpx!important}.development-tools{margin-top:32rpx}.development-tools>button{padding:12rpx 0;background:none;color:var(--client-muted,#8290a4);font-size:24rpx}.development-tools input{box-sizing:border-box;width:100%;margin:20rpx 0}
</style>
