<script setup lang="ts">
import ConsolePageHeading from './ConsolePageHeading.vue'
withDefaults(defineProps<{title?:string;description?:string;basicTitle?:string;asideTitle?:string}>(),{title:'个人资料',description:'管理你的头像和昵称。',basicTitle:'基本资料',asideTitle:'账号信息'})
</script>
<template><div class="space-y-6"><ConsolePageHeading :title="title" :description="description"/><div class="qisvc-console-profile-grid"><section class="surface-card space-y-6 p-6" :aria-label="basicTitle"><h2 class="font-semibold text-highlighted">{{basicTitle}}</h2><slot/></section><section v-if="$slots.aside" class="surface-card space-y-5 p-6" :aria-label="asideTitle"><h2 class="font-semibold text-highlighted">{{asideTitle}}</h2><slot name="aside"/></section></div></div></template>
<style scoped>
.qisvc-console-profile-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:1.5rem;align-items:start}@media(min-width:1280px){.qisvc-console-profile-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
</style>

