<script setup lang="ts">
defineProps<{name:string}>()
const glyphs:Record<string,number>={member:0xe761,clock:0xe7c3,right:0xe631,left:0xe62b}
</script>
<template><span class="niu-arrow" aria-hidden="true">{{String.fromCodePoint(glyphs[name]||0xe631)}}</span></template>
<style scoped>@font-face{font-family:NiuDecorationOfficial;src:url('/decoration/niucloud-official-icons.woff2') format('woff2');font-display:block}.niu-arrow{font-family:NiuDecorationOfficial!important;font-style:normal;font-weight:400;display:inline-block;line-height:1;font-size:inherit;flex-shrink:0}</style>
