<script setup lang="ts">
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleErrorState from '@orangezh1/qisvc-console-ui/components/ConsoleErrorState'
import {consoleTitle} from '../../utils/console-title'
const {target}=useConsoleNavigation(),context=useTenantContext()
const title=computed(()=>context.current.value?.site.consoleRoutes?.find(item=>item.path===target.value?.path)?.label||consoleTitle(target.value?.path||'','','').split(' · ')[0]||'正在打开页面')
</script>
<template>
 <section v-if="target" class="console-navigation-state" :aria-busy="!target.error" :aria-label="title">
  <ConsolePageHeading :title="title"/>
  <ConsoleErrorState v-if="target.error" :title="target.error"><template #actions><UButton :to="target.fullPath" external>重新打开</UButton></template></ConsoleErrorState>
  <div v-else role="status" :aria-label="'正在加载'+title" class="space-y-5">
   <span class="sr-only">正在加载{{title}}</span>
   <div aria-hidden="true" class="console-navigation-skeleton space-y-5"><div class="h-16 rounded-lg bg-elevated/60"/><div class="rounded-lg border border-default p-6 space-y-6"><div v-for="row in 5" :key="row" class="h-5 rounded bg-elevated/60" :class="row===5?'w-2/3':'w-full'"/></div></div>
  </div>
 </section>
</template>
<style scoped>
.console-navigation-state{min-width:0;flex:1}.console-navigation-skeleton{animation:console-loading-pulse 1.5s ease-in-out infinite}@keyframes console-loading-pulse{50%{opacity:.55}}@media(prefers-reduced-motion:reduce){.console-navigation-skeleton{animation:none}}
</style>
