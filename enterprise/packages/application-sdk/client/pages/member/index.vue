<script setup lang="ts">
import {onLoad} from '@dcloudio/uni-app'
import {computed,ref} from 'vue'
import ClientAssetTabs from '../../components/ClientAssetTabs.vue'
import ClientAssetRecords from '../../components/ClientAssetRecords.vue'
import ClientNavigation from '../../components/ClientNavigation.vue'
import ClientPageState from '../../components/ClientPageState.vue'
import ClientChevron from '../../components/ClientChevron.vue'
import {frameworkAsset} from '@qicore/application-sdk/browser/decoration-framework.mjs'
import {clientThemeStyle} from '../../lib/client-theme'
import {isH5,money} from '../../lib/api'
import {consumerLogin} from '../../lib/wallet'
import {useRecharge} from '../../lib/use-recharge'
const tab=ref('recharge'),tabs=[{id:'recharge',label:'套餐充值'},{id:'records',label:'积分明细'}]
onLoad(options=>{if(options?.tab==='records')tab.value='records'})
const {wallet,catalog,guest,action,error,createAction,createError,pending,load,submit,invalidate}=useRecharge('points'),selectedId=ref('')
const selected=computed(()=>catalog.value?.points.find(offer=>offer.id===selectedId.value)||catalog.value?.points[0]||null)
const guestIcon=(isH5?'/h5-assets':'')+frameworkAsset('icons/user-round-blue.svg',true)
const locked=computed(()=>!!action.value||!!createAction.value||!!pending.value&&!pending.value.id)
function select(id:string){if(!locked.value&&catalog.value?.points.some(offer=>offer.id===id))selectedId.value=id}
function purchase(){if(selected.value&&catalog.value)void submit({kind:'points_recharge',packageId:selected.value.id,version:catalog.value.version})}
function go(path:string){uni.navigateTo({url:'/pages/'+path+'/index'})}
</script>
<template><page-meta :page-style="clientThemeStyle"/>
 <view class="points-page">
  <ClientNavigation title="积分套餐" back/>
  <view v-if="!guest" class="asset-summary"><text>可用积分</text><view>{{(wallet?.points.amount??0).toLocaleString()}}</view></view>
  <ClientAssetTabs v-if="!guest" v-model="tab" :items="tabs" label="积分功能"/>
  <ClientAssetRecords v-if="!guest&&tab==='records'" kind="points" @unavailable="invalidate"/>
  <scroll-view enhanced v-else class="points-scroll" scroll-y :show-scrollbar="false"><view class="points-body">
   <view v-if="guest" class="guest-card">
    <view class="guest-icon"><image :src="guestIcon" mode="aspectFit" aria-hidden="true"/></view>
    <view class="guest-copy"><view class="guest-title">登录查看积分</view><text>管理充值记录与积分明细</text></view>
    <button role="button" class="guest-login" @click="consumerLogin">去登录</button>
   </view>
   <view v-if="error" class="points-error" role="alert"><text>{{error}}</text><button role="button" :loading="action==='retry'" :aria-disabled="!!action" :disabled="!!action" @click="load('retry')">重新加载</button></view>
   <view v-else-if="action&&!catalog" class="points-state" role="status">正在读取积分套餐…</view>
   <view v-if="createError" class="points-error" role="alert">{{createError}}<button v-if="!pending" role="button" :loading="action==='reload'" :disabled="!!action||!!createAction" @click="load('reload')">重新读取套餐</button></view>
   <view v-if="pending" class="pending-order"><text>{{pending.id?'已有充值订单，可继续查看或支付':'上次订单结果待确认，请先恢复原订单'}}</text><button role="button" class="small-link" :loading="createAction==='resume'" :disabled="!!action||!!createAction" @click="submit()">继续原订单</button></view>
   <template v-if="catalog">
    <view v-if="catalog.points.length||!guest" class="section-heading"><text>{{catalog.points.length?'选择充值套餐':'积分套餐'}}</text><button v-if="!guest" role="button" class="small-link" @click="go('orders')">订单记录<ClientChevron/></button></view>
    <ClientPageState v-if="!catalog.points.length" kind="empty" title="暂无积分套餐" description="套餐上架后会在这里展示" action-label=""/>
    <view class="point-offers"><button v-for="offer in catalog.points" :key="offer.id" role="button" class="point-offer" :class="{selected:selected?.id===offer.id}" :aria-pressed="selected?.id===offer.id" :disabled="locked" @click="select(offer.id)">
     <view class="offer-heading"><view class="offer-check" aria-hidden="true">{{selected?.id===offer.id?'✓':''}}</view><view class="offer-name">{{offer.name}}<view class="offer-credits">{{offer.points.toLocaleString()}} 积分</view></view><view class="offer-price"><text>¥</text>{{money(offer.priceCents)}}</view></view>
     <view v-if="offer.giftPoints" class="offer-bonus"><text>赠送 {{offer.giftPoints.toLocaleString()}} 积分</text><text>合计到账 {{(offer.points+offer.giftPoints).toLocaleString()}} 积分</text></view>
    </button></view>
   </template>
  </view></scroll-view>
  <view v-if="(guest||tab==='recharge')&&selected" class="purchase-footer"><view><text class="purchase-caption">{{selected.points.toLocaleString()}} 积分</text><view class="purchase-price"><text>¥</text>{{money(selected.priceCents)}}</view></view><button role="button" class="primary buy-button" :loading="createAction==='create'" :disabled="locked" @click="purchase">{{guest?'登录后充值':'积分充值'}}</button></view>
 </view>
</template>
<style scoped>
.points-page{display:flex;flex-direction:column;height:100dvh;max-width:480px;margin:auto;overflow:hidden;background:var(--client-page-background, #f3f9ff);color:var(--client-text,#203450);font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif}.points-page view,.points-page button{box-sizing:border-box}.points-page button{margin:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;line-height:1.5}.points-page button::after{border:0}.points-page button[disabled]{opacity:1}.points-scroll{flex:1;min-height:0;height:0}.points-body{padding:var(--client-content-top, 16px) var(--client-page-gutter, 10px) 28px}.preview-label{margin-bottom:12px;font-size:11px;color:var(--client-muted,#718198)}.asset-summary{padding:14px 20px 8px;color:var(--client-muted);font-size:12px}.asset-summary>view{margin-top:4px;color:var(--client-text);font-size:30px;font-weight:650;line-height:1.3}.points-page .small-link{display:flex;align-items:center;gap:4px;min-height:32px;font-size:12px;font-weight:400;color:var(--client-primary,#3479f6)}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 2px 12px;font-size:16px;font-weight:600}.point-offers{display:flex;flex-direction:column;gap:12px}.points-page .point-offer{width:100%;padding:17px 15px;border:2px solid #e7edf6;border-radius:16px;text-align:left;background:var(--client-surface,#fff)}.points-page .point-offer.selected{border-color:var(--client-primary-border,#9bbcff);background:var(--client-primary-soft,#edf4ff)}.offer-heading{display:flex;align-items:center;gap:10px}.offer-check{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:20px;height:20px;border:1.5px solid #d5deec;border-radius:50%;color:transparent;font-size:12px}.selected .offer-check{background:var(--client-primary,#3479f6);border-color:var(--client-primary,#3479f6);color:#fff}.offer-name{flex:1;min-width:0;font-size:16px;font-weight:600;overflow-wrap:anywhere}.offer-price{display:flex;align-items:baseline;gap:3px;color:var(--client-primary,#3479f6);font-size:23px;font-weight:650;white-space:nowrap}.offer-price>text{font-size:12px;font-weight:400}.offer-bonus{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid #e6edf8;color:var(--client-muted,#718198);font-size:11px}.offer-bonus>text:first-child{color:var(--client-primary,#3479f6)}.purchase-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px var(--client-page-gutter, 10px) calc(14px + env(safe-area-inset-bottom));background:var(--client-page-background, #f3f9ff)}.purchase-caption{display:block;font-size:11px;color:var(--client-muted,#718198)}.purchase-price{display:flex;align-items:baseline;gap:3px;color:var(--client-primary,#3479f6);font-size:26px;font-weight:650;line-height:1.3}.purchase-price>text{font-size:12px;font-weight:400}.points-page .primary{display:flex;align-items:center;justify-content:center;min-height:46px;border-radius:12px;background:var(--client-primary,#3479f6);color:#fff;font-size:15px;font-weight:600}.buy-button{width:140px;flex-shrink:0}.points-page .primary[disabled]{background:var(--client-primary-disabled,#dce7fa);color:#7e98bd}.points-state{padding:60px 16px;text-align:center;font-size:14px;color:var(--client-muted,#718198)}.points-error{padding:14px;margin-bottom:14px;border-radius:12px;background:#fff0ef;color:#b84039}.points-error button{display:flex;align-items:center;justify-content:center;min-height:36px;margin-top:10px;padding:0 14px;border-radius:8px;background:#ffe5e1}@media(max-width:350px){.points-body{padding-inline:var(--client-page-gutter, 10px)}.offer-name{font-size:14px}.offer-price{font-size:21px}.buy-button{width:124px}}
</style>

<style scoped>
.guest-card{display:flex;align-items:center;gap:12px;margin-bottom:24px;padding:18px 16px;border-radius:16px;background:var(--client-surface,#fff)}
.guest-icon{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:44px;height:44px;border-radius:50%;background:var(--client-primary-soft,#edf4ff)}
.guest-icon image{width:26px;height:26px}.guest-copy{flex:1;min-width:0;color:var(--client-muted,#718198);font-size:12px;line-height:1.6}.guest-title{margin-bottom:4px;color:var(--client-text,#203450);font-size:16px;font-weight:600}
.points-page .guest-login{flex-shrink:0;min-width:68px;min-height:36px;padding:8px 14px;border-radius:18px;background:var(--client-primary-soft,#edf4ff);color:var(--client-primary,#3479f6);font-size:13px;font-weight:600}
.guest-login:focus-visible{outline:2px solid var(--client-primary,#3479f6);outline-offset:3px}
.offer-credits{margin-top:5px;color:var(--client-muted);font-size:12px;font-weight:400}.pending-order{padding:12px;margin-bottom:14px;background:var(--client-primary-soft);border-radius:10px;font-size:12px;color:var(--client-muted)}.points-state .small-link{margin:12px auto 0}
@media(max-width:350px){.guest-card{gap:10px;padding:16px 12px}.guest-icon{width:36px;height:36px}.guest-title{font-size:15px}.guest-copy{font-size:11px}.points-page .guest-login{min-width:60px;padding-inline:10px}}
</style>
