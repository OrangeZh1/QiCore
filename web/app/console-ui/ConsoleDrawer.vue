<script setup lang="ts">
defineOptions({inheritAttrs:false})
withDefaults(defineProps<{title:string;description?:string;wide?:boolean}>(),{description:'',wide:false})
const open=defineModel<boolean>('open',{default:false})
</script>
<template><USlideover v-model:open="open" v-bind="$attrs" :title="title" :description="description" :ui="{content:'inset-y-3 right-3 w-[calc(100%-1.5rem)] max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-xl ring ring-default shadow-xl sm:inset-y-4 sm:right-4 sm:w-[calc(100%-2rem)] sm:max-h-[calc(100dvh-2rem)] '+(wide?'max-w-[46rem]':'max-w-[38rem]'),header:'shrink-0 items-start gap-3 px-5 py-5 sm:px-7',title:'pr-8 text-base font-semibold text-highlighted',description:'mt-1 pr-7 text-xs leading-5 text-muted',close:'top-4 right-4 sm:right-6',body:'min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-7',footer:'shrink-0 border-t border-default bg-default px-5 py-4 sm:px-7'}"><template #body><div class="console-drawer-content"><slot name="body"/></div></template><template v-if="$slots.footer" #footer><slot name="footer"/></template></USlideover></template>
<style scoped>
.console-drawer-content{min-width:0;color:var(--ui-text);line-height:1.6}
.console-drawer-content :deep(.drawer-detail>section+section){border-top:1px solid var(--ui-border);padding-top:1.5rem}
.console-drawer-content :deep(.drawer-facts){display:grid;grid-template-columns:7rem minmax(0,1fr);column-gap:1.25rem;row-gap:0;font-size:.875rem}
.console-drawer-content :deep(.drawer-facts>dt),.console-drawer-content :deep(.drawer-facts>dd){min-width:0;margin:0;padding:.8rem 0;border-bottom:1px solid var(--ui-border);overflow-wrap:anywhere}
.console-drawer-content :deep(.drawer-facts>dt){color:var(--ui-text-muted);font-size:.8125rem}
.console-drawer-content :deep(.drawer-facts>dt:last-of-type),.console-drawer-content :deep(.drawer-facts>dd:last-of-type){border-bottom:0}
.console-drawer-content :deep(.drawer-section-title){font-size:.875rem;font-weight:600;color:var(--ui-text-highlighted)}
.console-drawer-content :deep(.drawer-form-section){border-top:1px solid var(--ui-border);padding-top:1.5rem;font-size:.875rem;font-weight:600}
.console-drawer-content :deep(.drawer-form-section:first-child){border-top:0;padding-top:0}
@media(min-width:640px){.console-drawer-content :deep(.qisvc-console-settings-field){grid-template-columns:7.5rem minmax(0,1fr);column-gap:1rem}.console-drawer-content :deep(.qisvc-console-settings-label){justify-content:flex-start;text-align:left}}
@media(max-width:479px){.console-drawer-content :deep(.drawer-facts){grid-template-columns:6rem minmax(0,1fr);column-gap:1rem}}
</style>
