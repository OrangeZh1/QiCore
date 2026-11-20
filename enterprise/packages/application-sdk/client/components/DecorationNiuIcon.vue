<script setup lang="ts">
defineProps<{name:string}>()
const glyphs:Record<string,number>={image:0xe7dc,member:0xe761,clock:0xe7c3,right:0xe631,left:0xe62b,grid:0xe80b,close:0xe857}
</script>
<template><text class="niu-arrow" aria-hidden="true">{{String.fromCodePoint(glyphs[name]||0xe631)}}</text></template>
<style scoped>@import '../static/decoration/niu-icons.css';.niu-arrow{font-family:NiuDecorationOfficial!important;font-style:normal;font-weight:400;display:inline-block;line-height:1;font-size:inherit;flex-shrink:0}</style>
