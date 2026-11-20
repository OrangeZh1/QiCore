<script setup lang="ts">
import {sanitizeDecorationHtml} from '../../../../api/src/core/decoration-rich-text.mjs'
import {richMediaHtml} from '../../../../api/src/core/decoration-components.mjs'
const props=defineProps<{html:string;imageUrl:(id:string)=>string}>()
const content=computed(()=>richMediaHtml(sanitizeDecorationHtml(props.html),props.imageUrl))
</script>
<template><div v-if="content" v-html="content"/><p v-else class="empty">点击编辑富文本内容</p></template>
