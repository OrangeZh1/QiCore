<script setup lang="ts">
import {onLoad} from '@dcloudio/uni-app'
import {clientThemeStyle} from '../../lib/client-theme'
import {ref,computed} from 'vue'
import ClientChevron from '../../components/ClientChevron.vue'
import ClientNavigation from '../../components/ClientNavigation.vue'
import ClientPageState from '../../components/ClientPageState.vue'
import ClientAssetTabs from '../../components/ClientAssetTabs.vue'
import ClientAssetRecords from '../../components/ClientAssetRecords.vue'
import {money} from '../../lib/api'
import {rechargeCents} from '../../lib/recharge'
import {useRecharge} from '../../lib/use-recharge'
import {consumerLogin} from '../../lib/wallet'
const tab=ref('recharge'),tabs=[{id:'recharge',label:'余额充值'},{id:'records',label:'余额明细'}]
onLoad(options=>{if(options?.tab==='records')tab.value='records'})
const {wallet,catalog,guest,action,error,createAction,createError,pending,load,submit,invalidate}=useRecharge('balance')
const amount=ref(''),selectedId=ref(''),custom=ref(false)
const selected=computed(()=>catalog.value?.balance.tiers.find(item=>item.id===selectedId.value)||catalog.value?.balance.tiers[0]||null)
const cents=computed(()=>custom.value?rechargeCents(amount.value):selected.value?.amountCents??null)
const invalid=computed(()=>custom.value&&amount.value!==''&&(cents.value===null||!!catalog.value&&(cents.value<catalog.value.balance.minCents||cents.value>catalog.value.balance.maxCents)))
const locked=computed(()=>!!action.value||!!createAction.value||!!pending.value&&!pending.value.id)
const available=computed(()=>!!catalog.value&&(catalog.value.balance.tiers.length>0||catalog.value.balance.customEnabled))
function orders(){uni.navigateTo({url:'/pages/orders/index'})}
function choose(id:string){if(!locked.value){selectedId.value=id;custom.value=false}}
function inputAmount(event:Event){if(!locked.value){amount.value=(event as unknown as {detail:{value:string}}).detail.value;custom.value=true}}
function purchase(){if(!catalog.value||cents.value===null||invalid.value)return;void submit(custom.value?{kind:'balance_custom',amountCents:cents.value,version:catalog.value.version}:{kind:'balance_recharge',tierId:selected.value!.id,version:catalog.value.version})}
</script>
<template><page-meta :page-style="clientThemeStyle"/>
 <view class="recharge-page">
  <ClientNavigation title="我的余额" back/>
  <view v-if="!guest" class="asset-summary"><view class="asset-summary-heading"><text>账户余额（元）</text><button v-if="wallet" role="button" @click="orders">订单记录<ClientChevron/></button></view><view>{{wallet?'¥'+money(wallet.balance.amount):'—'}}</view></view>
  <ClientAssetTabs v-if="!guest" v-model="tab" :items="tabs" label="余额功能"/>
  <ClientAssetRecords v-if="!guest&&tab==='records'" kind="balance" @unavailable="invalidate"/>
  <scroll-view enhanced v-else class="recharge-scroll" scroll-y :show-scrollbar="false"><view class="recharge-body">
   <ClientPageState v-if="guest" title="登录后查看余额" description="查看收支明细，管理余额充值" @action="consumerLogin"/>
   <view v-if="error" class="recharge-error" role="alert">{{error}}<button role="button" :loading="action==='retry'" :aria-disabled="!!action" :disabled="!!action" @click="load('retry')">重新加载</button></view>
   <view v-else-if="!guest&&action&&!catalog" class="recharge-state" role="status">正在读取余额信息…</view>
   <view v-if="createError" class="recharge-error" role="alert">{{createError}}<button v-if="!pending" role="button" :loading="action==='reload'" :disabled="!!action||!!createAction" @click="load('reload')">重新读取档位</button></view>
   <view v-if="pending" class="pending-order"><text>{{pending.id?'已有充值订单，可继续查看或支付':'上次订单结果待确认，请先恢复原订单'}}</text><button role="button" :loading="createAction==='resume'" :disabled="!!action||!!createAction" @click="submit()">继续原订单</button></view>
   <view v-if="!guest&&catalog&&!available" class="recharge-state">暂无可用的充值方式</view>
   <view v-if="!guest&&catalog&&available" class="recharge-card"><view class="section-title">充值金额</view>
    <view class="amount-options"><button v-for="value in catalog.balance.tiers" :key="value.id" role="button" :aria-pressed="!custom&&selected?.id===value.id" :class="{selected:!custom&&selected?.id===value.id}" :disabled="locked" @click="choose(value.id)"><view><view><text>¥</text>{{money(value.amountCents)}}</view><text v-if="value.giftCents" class="gift-caption">赠送 ¥{{money(value.giftCents)}}</text></view></button></view>
    <view v-if="catalog.balance.customEnabled" class="custom-amount" :class="{focused:custom}"><text>¥</text><input :value="custom?amount:''" type="digit" :maxlength="10" :disabled="locked" placeholder="自定义充值金额" aria-label="自定义充值金额" @focus="if(!custom){custom=true;amount=''}" @input="inputAmount"/></view>
    <view v-if="catalog.balance.customEnabled" class="recharge-note">自定义金额 ¥{{money(catalog.balance.minCents)}}–¥{{money(catalog.balance.maxCents)}}，最多2位小数</view>
    <view v-if="invalid" class="amount-error" role="alert">请输入允许范围内的金额，最多保留2位小数</view>
   </view>
  </view></scroll-view>
  <view v-if="!guest&&tab==='recharge'&&available" class="recharge-footer"><view><text class="footer-caption">充值金额</text><view class="footer-amount"><text>¥</text>{{money(cents??0)}}</view></view><button role="button" class="confirm-recharge" :loading="createAction==='create'" :disabled="locked||invalid||cents===null" @click="purchase">确认充值</button></view>
 </view>
</template>
<style scoped>
.asset-summary{padding:14px 20px 8px;color:var(--client-muted);font-size:12px}.asset-summary>view{margin-top:4px;color:var(--client-text);font-size:30px;font-weight:650;line-height:1.3}
.wallet-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.wallet-heading button{display:flex;align-items:center;gap:4px;min-height:30px;margin:0;padding:0;border:0;background:transparent;color:var(--client-primary,#3479f6);font:12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif}
.recharge-page{display:flex;flex-direction:column;height:100dvh;max-width:480px;margin:auto;background:var(--client-page-background, #f3f9ff);color:var(--client-text, #1e293b);font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif}.recharge-scroll{flex:1;height:0;min-height:0}.recharge-body{padding:var(--client-content-top, 16px) var(--client-page-gutter, 10px) 16px}.wallet-summary{display:flex;flex-direction:column;gap:6px;padding:18px 20px;background:var(--client-surface,#fff);border:1px solid #e7edf6;border-radius:16px;color:#6d88ad;font-size:12px}.wallet-number{font-size:32px;line-height:1.3;color:var(--client-primary-ink, #28558d);font-weight:650}.recharge-card{padding:18px;margin-top:16px;border:1px solid #e7edf6;border-radius:16px;background:var(--client-surface, #ffffff)}.section-title{font-size:16px;font-weight:600;margin-bottom:10px}.amount-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:16px}.amount-options button{display:flex;align-items:center;justify-content:center;gap:4px;min-width:0;height:58px;margin:0;padding:0;border:1px solid #e1e8f3;border-radius:10px;background:var(--client-surface, #ffffff);color:#526781;font:600 20px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;box-sizing:border-box}.amount-options button text{font-size:12px;font-weight:400}.amount-options button.selected{background:var(--client-primary-soft, #edf4ff);border-color:var(--client-primary-border, #9bbcff);color:var(--client-primary, #2563eb)}.recharge-page button::after{border:0}.custom-amount{display:flex;align-items:center;gap:10px;border:1px solid #e1e8f3;border-radius:10px;margin-top:12px;padding:12px 14px}.custom-amount.focused{border-color:var(--client-primary-border, #9bbcff)}.custom-amount>text{font-size:18px;color:#526781}.custom-amount input{box-sizing:border-box;flex:1;min-width:0;width:0;height:26px;margin:0;padding:0;border:0;border-radius:0;background:transparent;font-size:15px;color:var(--client-text, #1e293b)}.custom-amount :deep(.uni-input-input){padding:0;border:0;border-radius:0;background:transparent}.amount-error{margin-top:8px;color:#b84039;font-size:12px}.payment-section{margin-top:24px;padding-top:22px;border-top:1px solid #edf1f7}.recharge-note{padding:16px 4px;color:#8a99ae;font-size:12px;text-align:center}.recharge-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px var(--client-page-gutter, 10px) calc(14px + env(safe-area-inset-bottom));border-top:0;background:var(--client-page-background, #f3f9ff)}.footer-caption{font-size:11px;color:#8a99ae}.footer-amount{display:flex;align-items:baseline;gap:3px;font-size:25px;color:var(--client-primary, #2563eb);font-weight:650;font-variant-numeric:tabular-nums}.footer-amount text{font-size:13px;font-weight:400}.confirm-recharge{display:flex;align-items:center;justify-content:center;min-width:140px;height:46px;margin:0;padding:0 16px;border:0;border-radius:12px;font-size:15px;font-weight:600}.confirm-recharge[disabled]{background:var(--client-primary-disabled, #dce7fa);color:#7e98bd;opacity:1}@media(max-width:350px){.recharge-card{padding:14px}.amount-options{gap:8px}.recharge-body{padding:var(--client-content-top, 16px) var(--client-page-gutter, 10px) 12px}.confirm-recharge{min-width:124px}}
.asset-summary>.asset-summary-heading{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:400;line-height:1.5;color:var(--client-muted)}.asset-summary-heading button{display:flex;align-items:center;gap:4px;min-height:30px;margin:0;padding:0;border:0;background:transparent;color:var(--client-primary);font:inherit;font-size:12px}.asset-summary-heading button::after{border:0}
</style>
<style scoped>.recharge-state{padding:56px 16px;text-align:center;color:var(--client-muted);font-size:14px}.recharge-state button,.recharge-error button,.pending-order button{margin:12px auto 0;padding:8px 12px;border:0;background:transparent;color:var(--client-primary);font:inherit;font-size:13px}.recharge-error{padding:14px;margin-bottom:14px;border-radius:12px;background:#fff0ef;color:#b84039;font-size:13px}.pending-order{padding:12px;margin-bottom:14px;background:var(--client-primary-soft);border-radius:10px;font-size:12px;color:var(--client-muted)}.gift-caption{display:block;font-size:10px!important;font-weight:400}.confirm-recharge{background:var(--client-primary);color:#fff}</style>
