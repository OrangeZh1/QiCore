<script setup lang="ts">
import {useMaintenanceReload} from '../../lib/maintenance'
import {runtimeConfig,clientImageUrl} from '../../lib/runtime-config'
import {clientThemeStyle} from '../../lib/client-theme'
import {ref,computed} from 'vue'
import {onLoad,onShow,onUnload} from '@dcloudio/uni-app'
import ClientNavigation from '../../components/ClientNavigation.vue'
import ClientChevron from '../../components/ClientChevron.vue'
import ClientDialog from '../../components/ClientDialog.vue'
import MemberLevelProgress from '../../components/MemberLevelProgress.vue'
import {api,consumerReady,consumerLogin,getToken,identityScope,isH5,isClientPreview,message} from '../../lib/api'
import {frameworkAsset} from '@qicore/application-sdk/browser/decoration-framework.mjs'
import {levelKey,type MemberLevel,type MemberLevelsView} from '../../lib/member-levels'
const catalog=ref<Pick<MemberLevelsView,'levels'|'growthRules'>|null>(null)
const data=ref<MemberLevelsView|null>(null),action=ref(''),error=ref(''),guest=ref(false),selectedId=ref('')
const previewData=ref(false),criteriaOpen=ref(false),openFaq=ref('')
const levels=computed(()=>data.value?.levels||catalog.value?.levels||[]),growthRules=computed(()=>data.value?.growthRules||catalog.value?.growthRules)
const activeIndex=computed(()=>Math.max(0,levels.value.findIndex(level=>levelKey(level)===selectedId.value))),selected=computed(()=>levels.value[activeIndex.value]),next=computed(()=>data.value?.nextId?data.value.levels.find(level=>level.id===data.value?.nextId):undefined)
const palette={header:'#edf4ff',headerInk:'#203450',accent:'#3479f6',soft:'#edf3ff',icon:'brightness(0) saturate(100%) invert(43%) sepia(99%) saturate(2561%) hue-rotate(204deg) brightness(99%) contrast(94%)'}
const themes=[
 {...palette,card:'linear-gradient(120deg, #f4f8ff 0%, #dfebff 45%, #c6dcff 100%)',ink:'#234a7d'},
 {...palette,header:'#c8dcf8',headerInk:'#214a81',accent:'#3566a4',soft:'#e9f1fc',card:'linear-gradient(115deg, #e8f1ff 0%, #b4cefa 38%, #d4e4ff 65%, #98bbed 100%)',ink:'#214a81'},
 {...palette,header:'#244677',headerInk:'#eff6ff',accent:'#365f96',soft:'#e9eff8',card:'linear-gradient(115deg, #41699d 0%, #244677 40%, #365f96 68%, #18375f 100%)',ink:'#eff6ff'},
]
const theme=computed(()=>themes[activeIndex.value%themes.length]!),asset=(name:string)=>(isH5?'/h5-assets':'')+'/static/member-levels/'+name
const avatar=computed(()=>clientImageUrl(data.value?.profile.avatar)||(isH5?'/h5-assets':'')+frameworkAsset('avatar.png',true))
let alive=true,sequence=0,loadedScope='',loadedToken='',loadedSite=''
function value(level:MemberLevel,key:string){return level.benefits.find(benefit=>benefit.key===key)?.value??'—'}
function isCurrent(level:MemberLevel){return !!data.value?.current.defined&&levelKey(level)===levelKey(data.value.current)}
const progressTarget=(level:MemberLevel)=>isCurrent(level)?next.value:level
const progressLevel=computed(()=>selected.value?progressTarget(selected.value):undefined)
const hasCriteria=computed(()=>!!progressLevel.value?.criteria.length)
const criteriaSummary=computed(()=>{
 const level=progressLevel.value
 if(level?.criteria.length)return level.name+' · '+(level.upgradeMode==='any'?'满足任一条件':'满足全部条件')
 if(level)return level.id===null?'默认会员等级，无需额外升级条件':'该等级由管理员设置，暂无自动升级条件'
 if(data.value?.nextState==='highest')return '当前已是最高等级'
 return data.value?.nextState==='manual'?'后续等级由管理员设置，暂无自动升级条件':'暂无可用的升级等级'
})
const faqs=computed(()=>[
 {id:'benefits',question:'等级权益如何使用？',answers:[...(selected.value?.description?[selected.value.description]:[]),'购买折扣以订单确认金额为准，消费成长值按下单时的等级倍率计算，不影响注册赠送。']},
 {id:'growth',question:'成长值怎么获得？',answers:[growthRules.value?.registration?'新用户注册可获得 '+growthRules.value.registration+' 成长值。':'本站暂未设置注册赠送成长值。',growthRules.value?.perYuan?'每实际支付 1 元，按 '+growthRules.value.perYuan+' 成长值的基础比例计算，再应用下单时的等级倍率。':'本站暂未设置消费赠送成长值。']},
 {id:'refund',question:'退款会影响成长值和等级吗？',answers:['退款按原订单规则扣回对应成长值；已获得的等级不会自动降低。管理员可按实际情况调整等级。']},
 {id:'subscription',question:'会员等级和积分有什么区别？',answers:['会员等级提供当前等级对应的购买折扣、消费成长值倍率等权益。积分和人民币余额是账户资产；购买积分不直接决定会员等级，成长值仅用于等级评定。']},
])
function toggleFaq(id:string){if(faqs.value.some(item=>item.id===id))openFaq.value=openFaq.value===id?'':id}
function openCriteria(){if(hasCriteria.value)criteriaOpen.value=true}
function openRecords(){uni.navigateTo({url:'/pages/growth-records/index'+(isClientPreview&&previewData.value?'?demo=1':'')})}
function state(level:MemberLevel){if(guest.value)return level.criteria.length?'升级条件':'等级说明';return isCurrent(level)?'当前等级':level.rank<(data.value?.current.rank??-1)?'低于当前等级':level.criteria.length?'按条件升级':'管理员设置'}
function selectLevel(index:number){const level=levels.value[index];if(level){selectedId.value=levelKey(level);criteriaOpen.value=false}}
function togglePreview(){if(!isClientPreview||action.value)return;previewData.value=!previewData.value;data.value=null;criteriaOpen.value=false;openFaq.value='';selectedId.value='';void load('preview')}
function login(){consumerLogin()}
function clearLevels(){data.value=null;catalog.value=null;criteriaOpen.value=false;openFaq.value='';selectedId.value=''}
function siteScope(){const c=runtimeConfig();return[c.apiBase,c.tenantId,c.applicationKey].join('|')}
async function load(source='initial'){
 if(!alive||source==='maintenance'&&action.value)return
 const site=siteScope()
 const attempt=++sequence;let token=getToken(),scope=identityScope();
 if(loadedSite!==site||loadedToken!==token||loadedScope!==scope){loadedSite=site;clearLevels();error.value='';loadedToken=token;loadedScope=scope}
 action.value=data.value&&source==='initial'?'reload':source;if(source!=='retry')error.value='';guest.value=!getToken();
 const active=()=>alive&&attempt===sequence
 const sameIdentity=()=>site===siteScope()&&token===getToken()&&scope===identityScope()
 async function publicCatalog(){
  if(!active()||site!==siteScope())return
  const preserve=source==='maintenance'&&guest.value&&sameIdentity();if(preserve)data.value=null;else clearLevels();error.value='';guest.value=true;loadedToken=token=getToken();loadedScope=scope=identityScope()
  const c=runtimeConfig()
  try{const result=await api<Pick<MemberLevelsView,'levels'|'growthRules'>>('/public/client/member-levels?tenantId='+encodeURIComponent(c.tenantId)+'&applicationKey='+encodeURIComponent(c.applicationKey));if(active()&&sameIdentity()){catalog.value=result;if(!result.levels.some(level=>levelKey(level)===selectedId.value)){selectedId.value=result.levels[0]?levelKey(result.levels[0]):'';criteriaOpen.value=false}}}
  catch(e){if(active()&&sameIdentity())error.value=message(e)}
 }
 try{
  const ready=await consumerReady().catch(e=>{if(e?.status===401)return false;throw e});if(!active())return
  if(site!==siteScope())throw Error('站点已变化，请重新读取会员等级')
  if(!ready){await publicCatalog();return}
  guest.value=false;loadedToken=token=getToken();loadedScope=scope=identityScope()
  const result=await api<MemberLevelsView>(isClientPreview&&previewData.value?'/dev/member-levels':'/member-levels');if(!active())return
  if(!sameIdentity())throw Error('登录状态已变化，请重新读取会员等级')
  error.value='';catalog.value=null;data.value=result
  if(!result.levels.some(level=>levelKey(level)===selectedId.value))selectedId.value=result.levels.some(level=>levelKey(level)===levelKey(result.current))?levelKey(result.current):result.levels[0]?levelKey(result.levels[0]):''
 }catch(e:any){
  if(!active())return
  const unauthorized=e.status===401||['LOGIN_REQUIRED','UNAUTHENTICATED'].includes(e.code)
  if(site===siteScope()&&(!getToken()||sameIdentity()&&unauthorized)){await publicCatalog();return}
  if(!sameIdentity()||e.status===403)clearLevels();guest.value=!getToken();error.value=message(e)
 }
 finally{if(alive&&attempt===sequence)action.value=''}
}
onShow(()=>void load())
onLoad(options=>{previewData.value=!!isClientPreview&&options?.demo==='1'})
onUnload(()=>{alive=false;sequence++;clearLevels()})
useMaintenanceReload(()=>load('maintenance'),()=>!!action.value)
</script>
<template><page-meta :page-style="clientThemeStyle"/>
 <view class="member-page" :style="{'--member-header':theme.header,'--member-header-ink':theme.headerInk,'--member-accent':theme.accent,'--member-soft':theme.soft,'--member-icon-filter':theme.icon,'--member-link':activeIndex%themes.length===2?'#dceaff':theme.accent}">
  <view class="member-navigation"><ClientNavigation title="会员等级" back :background="theme.header" :ink="theme.headerInk"/></view><view v-if="isClientPreview" class="level-preview-mode"><text>{{previewData?'演示数据':'当前站点数据'}}</text><button role="button" class="plain" :loading="action==='preview'" :disabled="!!action" @click="togglePreview">{{previewData?'切换站点数据':'切换演示数据'}}</button></view>
  <scroll-view enhanced class="member-scroll" scroll-y :show-scrollbar="false">
   <view v-if="action&&!data&&!catalog&&!error" class="member-state" role="status">正在读取会员等级…</view>
   <view v-if="error" class="level-error" role="alert"><text>{{error}}</text><button role="button" class="plain" :loading="action==='retry'" :disabled="!!action" @click="load('retry')">重新加载</button></view>
   <template v-if="data||catalog">
    <view class="member-hero">
     <button v-if="guest" role="button" class="plain member-guest-login" @click="login">登录查看我的等级<ClientChevron/></button><view v-else-if="data" class="member-identity"><view class="member-avatar"><image :src="avatar" mode="aspectFill"/></view><view class="member-identity-copy"><view class="member-identity-name"><text class="member-name">{{data.profile.name}}</text><text class="member-badge">{{data.current.name}}</text></view></view><button role="button" class="plain growth-records-link" :disabled="!!action" @click="openRecords">成长记录<ClientChevron/></button></view>
     <template v-if="levels.length"><swiper class="member-carousel" :current="activeIndex" previous-margin="19px" next-margin="19px" :duration="320" @change="selectLevel($event.detail.current)"><swiper-item v-for="(level,index) in levels" :key="levelKey(level)" class="member-slide"><button role="button" class="plain member-level-card" :class="{current:activeIndex===index,'level-card-dark':index%3===2}" :style="{background:themes[index%themes.length]!.card,color:themes[index%themes.length]!.ink}" :aria-label="level.name+'，'+state(level)+'，选择该等级'" @click="selectLevel(index)" @keydown.left.prevent="selectLevel(activeIndex-1)" @keydown.right.prevent="selectLevel(activeIndex+1)"><view class="member-level-top"><text class="member-level-eyebrow">专属会员等级</text><image class="member-level-crown" :src="asset('crown.png')" mode="aspectFit"/></view><view class="member-level-name-row"><text class="member-level-name">{{level.name}}</text><text class="member-level-duration">{{state(level)}}</text></view><view class="member-level-bottom"><view class="member-level-discount"><text>{{value(level,'discountBps')}}</text><text class="member-level-discount-unit">折</text><text class="member-level-discount-label">购买优惠</text></view><view class="member-level-perks"><text>{{value(level,'growthMultiplierBps')}} 倍消费成长</text><text>{{level.id===null?'默认会员等级':level.criteria.length?'满足条件可升级':'按管理员设置获得'}}</text></view></view></button></swiper-item></swiper>
     <scroll-view enhanced scroll-x :show-scrollbar="false" class="member-tabs-scroll"><view class="member-level-tabs" role="tablist" aria-label="切换会员等级"><button v-for="(level,index) in levels" :key="levelKey(level)" class="plain member-level-tab" :class="{current:activeIndex===index}" role="tab" :aria-selected="activeIndex===index" @click="selectLevel(index)"><view class="member-level-dot"/><text>{{level.name}}</text></button></view></scroll-view></template>
    </view>
    <view v-if="selected" class="member-content">
     <button v-if="hasCriteria&&progressLevel" role="button" tabindex="0" class="plain member-card upgrade-entry" @click="openCriteria" @keydown.enter.prevent="openCriteria"><view class="upgrade-entry-copy"><text class="upgrade-entry-title">升级条件</text><text class="upgrade-entry-subtitle">{{criteriaSummary}}</text></view><view class="upgrade-entry-action"><text>查看</text><ClientChevron/></view></button>
     <view v-else class="member-card upgrade-empty">{{criteriaSummary}}</view>
     <view class="member-card member-faq">
      <view class="member-section-heading"><text>常见问题</text></view>
      <view v-for="item in faqs" :key="item.id" class="faq-item"><button role="button" tabindex="0" class="plain faq-question" :aria-expanded="openFaq===item.id" :aria-controls="'level-faq-'+item.id" @click="toggleFaq(item.id)" @keydown.enter.prevent="toggleFaq(item.id)"><text>{{item.question}}</text><text class="faq-toggle" aria-hidden="true">{{openFaq===item.id?'−':'+'}}</text></button><view v-if="openFaq===item.id" :id="'level-faq-'+item.id" class="faq-answer"><text v-for="answer in item.answers" :key="answer">{{answer}}</text></view></view>
     </view>
    </view><view v-else class="member-state">本站暂未配置会员等级</view>
   </template>
  </scroll-view>
  <ClientDialog v-if="criteriaOpen&&(data||catalog)&&selected&&progressLevel&&hasCriteria" title="升级条件" presentation="sheet" :close-icon="asset('x.png')" @close="criteriaOpen=false">
   <view class="upgrade-target">{{isCurrent(selected)?'下一等级':'目标等级'}} · <text>{{progressLevel.name}}</text></view>
   <view class="upgrade-modal-mode">{{progressLevel.upgradeMode==='any'?'满足以下任一条件可升级':'满足以下全部条件可升级'}}</view>
   <view v-if="guest" class="public-level-criteria"><view v-for="criterion in progressLevel.criteria" :key="criterion.key"><text>{{criterion.label}}</text><text>{{criterion.targetText}}</text></view></view><MemberLevelProgress v-else class="upgrade-progress" :criteria="progressLevel.criteria"/>
   <view class="upgrade-footnote">条件达标后，以实际等级评定结果为准。</view>
   <template #footer><button role="button" class="primary level-criteria-done" @click="criteriaOpen=false">我知道了</button></template>
  </ClientDialog>

 </view>
</template>
<style scoped>
.member-page .growth-records-link{display:flex;align-items:center;justify-content:flex-end;gap:4px;flex-shrink:0;min-height:32px;color:var(--member-link);font-size:12px;font-weight:400}
.member-page{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;font-size:28rpx;--radius-card:20rpx;--height-action:88rpx;box-sizing:border-box;max-width:480px;margin:auto}.member-page view,.member-page button{box-sizing:border-box}button{margin:0;font:inherit;line-height:inherit}.member-page button::after{border:0}.plain{margin:0;padding:0;background:transparent;border:0;font:inherit;line-height:inherit;color:inherit}.primary{display:flex;align-items:center;justify-content:center;height:88rpx;padding:0 24rpx;border-radius:20rpx;color:white;font-size:28rpx;font-weight:700;line-height:1}


.member-page { display: flex; flex-direction: column; height: calc(100vh - var(--window-top, 0px)); overflow: hidden; background:var(--client-page-background, #f3f9ff); color:var(--client-text, #1e293b); }

.member-navigation { position: relative; z-index: 2; margin-bottom: -1px; flex-shrink: 0; background-color: var(--member-header); color: var(--member-header-ink); transition: background-color 400ms ease, color 400ms ease; }

.member-navigation :deep(.app-navigation-back-icon) { filter:none; }


.member-scroll { flex: 1; min-height: 0; height: 0; }

/* Match the swiper's 19px inset plus the slide's 10rpx padding, including after resize. */
.member-hero { padding: 24rpx calc(19px + 10rpx) 32rpx; background-color:var(--member-header);background-image:linear-gradient(180deg,transparent 58%,var(--client-background));transition:background-color 400ms ease; }

.member-identity { display: flex; align-items: center; gap: 16rpx; color: var(--member-header-ink); transition: color 400ms ease; }

.member-avatar { display: flex; align-items: center; justify-content: center; width: 80rpx; height: 80rpx; flex-shrink: 0; border: 2rpx solid #ffffff8c; border-radius: 50%; background: #ffffff4d; }

.member-avatar { overflow: hidden; }

.member-avatar image { width: 100%; height: 100%; object-fit: cover; }

.member-identity-copy { display: flex; flex: 1; flex-direction: row; align-items: center; flex-wrap: wrap; gap: 10rpx 16rpx; min-width: 0; }

.member-name { font-size: 31rpx; font-weight: 600; letter-spacing: 1rpx; }

.member-badge { font-size: 19rpx; padding: 2rpx 12rpx; border: 1rpx solid currentColor; border-radius: 6rpx; color: inherit; opacity: .65; }


.member-content { padding:0 var(--client-page-gutter, 10px) 0; margin-top: -24rpx; position: relative; }

.member-content > .member-card:first-child { margin-top: 0; }

.member-carousel { width: calc(100% + 38px + 20rpx); margin: 24rpx calc(-19px - 10rpx) 0; height: 346rpx; }

.member-slide { box-sizing: border-box; display: flex; align-items: center; padding: 0 10rpx; }

.member-level-card { position: relative; display: flex; flex-direction: column; justify-content: space-between; width: 100%; height: 308rpx; padding: 30rpx 32rpx; border-radius: 26rpx; border: 1rpx solid #ffffffb3; box-shadow: inset 0 1rpx 0 #ffffffb3, 0 8rpx 20rpx #284e8310; text-align: left; overflow: hidden; transform: scale(.94); opacity: .65; transition: transform 320ms ease, opacity 320ms ease; }

.member-level-card.current { transform: scale(1); opacity: 1; }

.member-level-card::before { content: ''; position: absolute; width: 550rpx; height: 550rpx; border: 1rpx solid #ffffff33; box-shadow: 0 0 0 24rpx #ffffff05, 0 0 0 48rpx #ffffff05, 0 0 0 72rpx #ffffff04; border-radius: 50%; right: -340rpx; top: -190rpx; pointer-events: none; }

.member-level-top { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; position: relative; }

.member-level-eyebrow { font-size: 21rpx; letter-spacing: 3rpx; opacity: .72; }

.member-level-crown { width: 40rpx; height: 40rpx; opacity: .6; filter: var(--member-icon-filter); }

.level-card-dark .member-level-crown { filter: brightness(0) invert(1); }

.member-level-name-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12rpx; }

.member-level-name { font-size: 44rpx; font-weight: 700; letter-spacing: 1rpx; line-height: 1.35; }

.member-level-duration { font-size: 20rpx; line-height: 1.5; padding: 5rpx 12rpx; border: 1rpx solid #ffffff70; background: #ffffff32; border-radius: 9rpx; white-space: nowrap; }

.member-level-bottom { display: flex; justify-content: space-between; align-items: flex-end; gap: 12rpx; padding-top: 22rpx; border-top: 1rpx solid #ffffff40; }

.member-level-discount { display: flex; align-items: baseline; gap: 6rpx; font-size: 52rpx; font-weight: 500; line-height: 1.1; }

.member-level-discount-unit { font-size: 25rpx; }

.member-level-discount-label { font-size: 20rpx; margin-left: 8rpx; opacity: .78; font-weight: 400; }

.member-level-perks { display: flex; flex-direction: column; align-items: flex-end; gap: 5rpx; font-size: 21rpx; line-height: 1.5; opacity: .82; }

.member-level-tabs { display: flex; justify-content: center; gap: 20rpx; margin-top: 8rpx; }

.member-level-tab { display: flex; align-items: center; justify-content: center; gap: 8rpx; min-height: 58rpx; padding: 0 12rpx; border-radius: 10rpx; color: #7a8ba3; font-size: 23rpx; }

.member-level-tab.current { color: var(--client-primary, #2563eb); font-weight: 600; background: #ffffffb8; }

.member-level-dot { width: 8rpx; height: 8rpx; border-radius: 8rpx; background: currentColor; transition: width 320ms ease; }

.member-level-tab.current .member-level-dot { width: 24rpx; }

.member-card { display: block; width: 100%; margin-top: 20rpx; padding: 28rpx; border: 1rpx solid #e8eef8; border-radius: 24rpx; background:var(--client-surface, #ffffff); }

.member-section-heading { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10rpx; margin-bottom: 32rpx; font-size: 30rpx; font-weight: 650; letter-spacing: 0; }

.member-card{box-sizing:border-box}.member-page{height:100dvh}.member-content{padding-bottom:calc(36rpx + env(safe-area-inset-bottom))}.member-state{display:flex;flex-direction:column;align-items:center;gap:20px;padding:60px 24px;font-size:16px;color:#87909e;text-align:center;line-height:1.8}.member-state image{width:48px;height:48px;opacity:.6}.member-state .primary{min-width:160px;background:var(--member-accent)}.level-error{margin:16px;padding:16px;border-radius:12px;background:#fff0ef;color:#b84039;font-size:14px}.level-error button{display:block;color:inherit;margin-top:8px}
.member-level-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.member-level-perks{flex-shrink:0}.member-tabs-scroll{white-space:nowrap}.member-level-tabs{min-width:max-content}.member-level-tab{flex-shrink:0}.member-level-tab:focus-visible,.member-level-card:focus-visible{outline:2px solid var(--member-accent);outline-offset:-2px}
.member-identity-copy{flex-direction:column;align-items:stretch;gap:5rpx}.member-identity-name{display:flex;align-items:center;gap:12rpx;min-width:0}.member-name{min-width:0;max-width:calc(100% - 140rpx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:31rpx;line-height:40rpx;letter-spacing:0}.member-badge{flex-shrink:0;font-size:20rpx;padding:3rpx 10rpx;border:0;background:#dfeaff;color:#3568af;opacity:1;border-radius:7rpx}
.member-section-heading{font-size:16px;line-height:24px;margin-bottom:16px}.upgrade-mode{font-size:12px;font-weight:400;padding:3px 8px;border-radius:6px;background:var(--client-primary-soft, #edf4ff);color:var(--client-primary, #2563eb)}.upgrade-target{font-size:13px;line-height:1.7;color:#8794a7;margin-bottom:20px}.upgrade-target text{color:#435773;font-weight:500}.upgrade-progress{--level-progress-ink:#52647c;--level-progress-track:#e7eef9;--level-progress-fill:var(--client-primary, #2563eb)}.upgrade-progress :deep(.level-progress-item){display:block}.upgrade-progress :deep(.level-progress-item+.level-progress-item){margin-top:22px}.upgrade-progress :deep(.level-progress-label){justify-content:space-between;gap:8px;font-size:14px;line-height:1.6}.upgrade-progress :deep(.level-progress-number){color:var(--client-primary, #2563eb);font-weight:600}.upgrade-progress :deep(.level-progress-track){width:100%;height:6px;margin-top:10px;transform:none}.upgrade-footnote{margin-top:20px;padding-top:14px;border-top:1px solid #edf2f8;color:#9299a5;font-size:12px;line-height:1.7}.upgrade-empty{font-size:14px;line-height:1.8;color:#8794a7}
.level-preview-mode{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-shrink:0;padding:4px 24px 10px;background:var(--client-primary-soft, #edf4ff);font-size:12px;color:#7188a8}.level-preview-mode button{display:flex;align-items:center;justify-content:center;width:128px;min-width:128px;min-height:32px;padding:0 8px;color:var(--client-primary, #2563eb);font-size:12px;line-height:1.5}.level-preview-mode button[disabled]{opacity:1}
@media(max-width:340px){.member-level-name{font-size:36rpx}.member-level-perks{font-size:19rpx}.member-level-discount{font-size:46rpx}}
.upgrade-entry{display:flex;align-items:center;justify-content:space-between;gap:16px;text-align:left;min-height:84px;padding:18px 16px;background:var(--client-surface, #ffffff);border:1px solid #e8eef8}.upgrade-entry-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:5px}.upgrade-entry-title{font-size:15px;font-weight:600;color:var(--client-text, #1e293b)}.upgrade-entry-subtitle{font-size:12px;line-height:1.7;color:#8794a7;overflow-wrap:anywhere}.upgrade-entry-action{display:flex;align-items:center;gap:4px;flex-shrink:0;color:var(--client-primary, #2563eb);font-size:12px}.upgrade-modal-mode{font-size:14px;color:#52647c;margin-bottom:22px}.level-criteria-done{width:100%;height:48px;margin:0;background:var(--client-primary, #2563eb)}.member-faq .member-section-heading{margin-bottom:4px}.faq-item+.faq-item{border-top:1px solid #edf2f8}.faq-question{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;min-height:54px;text-align:left;font-size:14px;color:#435773}.faq-toggle{flex-shrink:0;color:#8794a7;font-size:22px;font-weight:400}.faq-answer{display:flex;flex-direction:column;gap:8px;padding:0 24px 16px 0;font-size:13px;line-height:1.8;color:#8290a5}.upgrade-entry:focus-visible,.faq-question:focus-visible{outline:2px solid var(--client-primary-border, #9bbcff);outline-offset:2px}
.level-preview-mode{background:var(--member-header);color:var(--member-header-ink);transition:background-color 400ms ease,color 400ms ease}.level-preview-mode button{color:var(--member-link)}.member-badge{background:#ffffff30;color:inherit;border:1rpx solid #ffffff55}.member-identity .growth-records-link :deep(.client-chevron){color:inherit}.member-level-tab.current{color:var(--member-accent)}
</style>

<style scoped>.member-page .member-guest-login{display:flex;align-items:center;justify-content:flex-end;gap:4px;width:100%;min-height:36px;margin-bottom:14px;color:var(--member-link);font-size:13px}.public-level-criteria>view{display:flex;justify-content:space-between;gap:16px;padding:12px 0;font-size:14px;border-bottom:1px solid var(--client-border,#e7edf5)}</style>
