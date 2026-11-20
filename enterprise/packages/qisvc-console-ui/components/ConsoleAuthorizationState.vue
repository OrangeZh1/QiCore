<script setup lang="ts">
import {computed} from 'vue'
export type AuthorizationState='unlicensed'|'expired'|'suspended'|'active'|'unavailable'
const props=withDefaults(defineProps<{state:AuthorizationState;message?:string;expiresAt?:string|null;checkedAt?:string|null;loading?:boolean;feedback?:string}>(),{message:'',expiresAt:null,checkedAt:null,loading:false,feedback:''})
const emit=defineEmits<{recheck:[]}>()
const view=computed(()=>({
 unlicensed:{title:'未授权',description:'当前部署尚未获得使用授权，请联系平台管理员完成授权。',icon:'i-lucide-shield-question',color:'warning' as const,action:'完成授权后，可重新校验授权状态。'},
 expired:{title:'授权到期',description:'当前授权已到期，请联系平台管理员续期。',icon:'i-lucide-calendar-clock',color:'warning' as const,action:'续期完成后，可重新校验以恢复使用。'},
 suspended:{title:'授权封禁',description:'当前授权已被封禁或停用，请联系平台管理员核实处理。',icon:'i-lucide-shield-ban',color:'error' as const,action:'解除封禁并重新校验成功后，才能恢复使用。'},
 active:{title:'授权正常',description:'当前授权有效，可以正常使用已授权功能。',icon:'i-lucide-shield-check',color:'success' as const,action:'到期时间以服务端核验结果为准。'},
 unavailable:{title:'授权校验失败',description:'暂时无法确认授权状态，请稍后重试。',icon:'i-lucide-wifi-off',color:'neutral' as const,action:'网络异常不等于授权封禁，请重新校验。'}
}[props.state]))
function date(value:string|null){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d)}
</script>
<template>
 <section class="qisvc-authorization-state" :data-state="state" aria-live="polite" aria-atomic="true">
  <div class="qisvc-authorization-heading"><span class="qisvc-authorization-icon" :data-color="view.color"><UIcon :name="view.icon"/></span><div><UBadge :color="view.color" variant="soft" size="sm">{{state==='active'?'授权有效':'授权提醒'}}</UBadge><h2>{{view.title}}</h2></div></div>
  <p class="qisvc-authorization-description">{{message||view.description}}</p>
  <dl class="qisvc-authorization-facts"><div><dt>授权到期时间</dt><dd>{{expiresAt?date(expiresAt):state==='active'?'未提供到期时间':'暂未获取'}}</dd></div><div><dt>最近校验</dt><dd>{{date(checkedAt)}}</dd></div></dl>
  <p class="qisvc-authorization-guidance">{{view.action}}</p>
  <UAlert v-if="feedback" :title="feedback" :color="state==='active'?'success':'neutral'" variant="soft" class="mt-4"/>
  <div class="qisvc-authorization-actions"><UButton icon="i-lucide-refresh-cw" :loading="loading" :disabled="loading" @click="emit('recheck')">重新校验</UButton><slot name="actions"/></div>
 </section>
</template>
<style scoped>
.qisvc-authorization-state{max-width:680px;width:100%;padding:28px;background:var(--ui-bg);border:1px solid var(--ui-border);border-radius:12px}.qisvc-authorization-heading{display:flex;align-items:center;gap:16px}.qisvc-authorization-icon{display:grid;place-items:center;width:58px;height:58px;border-radius:14px;font-size:28px;background:var(--ui-bg-elevated);color:var(--ui-text-muted)}.qisvc-authorization-icon[data-color=warning]{background:color-mix(in srgb,var(--ui-warning) 10%,transparent);color:var(--ui-warning)}.qisvc-authorization-icon[data-color=error]{background:color-mix(in srgb,var(--ui-error) 10%,transparent);color:var(--ui-error)}.qisvc-authorization-icon[data-color=success]{background:color-mix(in srgb,var(--ui-success) 10%,transparent);color:var(--ui-success)}.qisvc-authorization-heading h2{font-size:24px;font-weight:600;line-height:1.4;margin-top:5px}.qisvc-authorization-description{font-size:14px;line-height:1.9;color:var(--ui-text-muted);margin:22px 0}.qisvc-authorization-facts{display:grid;grid-template-columns:1fr 1fr;gap:16px;border-block:1px solid var(--ui-border);padding:18px 0}.qisvc-authorization-facts dt{font-size:11px;color:var(--ui-text-muted);margin-bottom:6px}.qisvc-authorization-facts dd{font-size:13px;font-weight:500}.qisvc-authorization-guidance{font-size:12px;color:var(--ui-text-muted);line-height:1.8;margin-top:18px}.qisvc-authorization-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}@media(max-width:520px){.qisvc-authorization-state{padding:20px}.qisvc-authorization-facts{grid-template-columns:1fr}.qisvc-authorization-heading h2{font-size:22px}}
</style>

