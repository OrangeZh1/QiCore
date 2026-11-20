<script setup lang="ts">
defineProps<{type:string;fallback?:string}>()
const glyphs:Record<string,number>={text:0xe7ea,banner:0xe7dc,links:0xe7da,gallery:0xe7e6,'hot-area':0xe7d7,membership:0xe7f2,notice:0xe7f3,'rich-text':0xe7ef,activity:0xe7e6,'search-box':0xe7e2,search:0xe7e2,float:0xe7f1,spacer:0xe7f4,divider:0xe7e9,showcase:0xe83c}
</script>
<template><UIcon v-if="type==='wechat-ad'" name="i-lucide-megaphone"/><UIcon v-else-if="type==='assets'" name="i-lucide-wallet"/><span v-else-if="glyphs[type]" class="niu-component-icon" aria-hidden="true">{{String.fromCodePoint(glyphs[type]!)}}</span><UIcon v-else :name="fallback||'i-lucide-layout-grid'"/></template>
<style scoped>@font-face{font-family:NiuDecorationIcons;src:url('/decoration/niucloud-icons.woff2') format('woff2');font-display:block}.niu-component-icon{font-family:NiuDecorationIcons!important;font-size:26px;font-weight:400;line-height:1;display:inline-block;width:1em;height:1em;color:inherit}</style>
