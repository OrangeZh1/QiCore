<script lang="ts">
export type PaymentAttempt={paymentId:string;sequence:number;provider:string;state:string;current:boolean;createdAt:string;paidAt:string|null;payerTotalCents:number|null;refundedCents:number;refund?:{state:string;lastError?:string|null}|null}
</script>
<script setup lang="ts">
import {dateTime} from '../../utils/update-center'
defineProps<{items:PaymentAttempt[]}>()
const providers:Record<string,string>={wechat:'微信支付',alipay:'支付宝',balance:'余额支付'}
const states:Record<string,string>={PREPARING:'结果待确认',READY:'待支付',PAID:'已支付',CLOSED:'已关闭',COMPENSATION:'待退款补偿',PARTIAL_REFUND:'部分退款',REFUNDED:'已退款',REVIEW:'待核查'}
const refunds:Record<string,string>={APPLIED:'待审核',PENDING:'待处理',PROCESSING:'处理中',ABNORMAL:'待核查',CLOSED:'已关闭，待核查',SUCCESS:'已成功',REJECTED:'已拒绝'}
const money=(n:number)=>'¥ '+Math.trunc(n/100)+'.'+String(n%100).padStart(2,'0')
</script>
<template>
 <section v-if="items.length" class="mt-6 border-t border-default pt-5" aria-label="支付记录">
  <h3 class="mb-3 text-sm font-semibold">支付记录</h3>
  <ol class="divide-y divide-default">
   <li v-for="item in items" :key="item.paymentId" class="py-4 first:pt-0 last:pb-0">
    <div class="flex flex-wrap items-center justify-between gap-2 text-sm"><span class="font-medium">第 {{item.sequence}} 次 · {{providers[item.provider]||item.provider}}</span><span class="text-muted">{{item.current?'当前支付':'已切换'}} · {{states[item.state]||'待核查'}}</span></div>
    <dl class="mt-3 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
     <dt class="text-muted">支付编号</dt><dd class="break-all">{{item.paymentId}}</dd>
     <dt class="text-muted">发起时间</dt><dd>{{dateTime(item.createdAt)}}</dd>
     <template v-if="item.paidAt"><dt class="text-muted">到账时间</dt><dd>{{dateTime(item.paidAt)}}</dd><dt class="text-muted">实付金额</dt><dd>{{item.payerTotalCents==null?'—':money(item.payerTotalCents)}}</dd></template>
     <template v-if="item.refund"><dt class="text-muted">{{item.current?'退款状态':'退款补偿'}}</dt><dd>{{refunds[item.refund.state]||'待核查'}}<span v-if="item.refund.lastError">，需查询原退款结果</span></dd></template>
     <template v-if="item.refundedCents"><dt class="text-muted">已退金额</dt><dd>{{money(item.refundedCents)}}</dd></template>
    </dl>
   </li>
  </ol>
 </section>
</template>
