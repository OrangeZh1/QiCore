<script setup lang="ts">
import {clientThemeStyle} from '../../lib/client-theme'
import {ref} from 'vue'
import {onLoad} from '@dcloudio/uni-app'
import {isDecorationWebUrl} from '@qicore/application-sdk/browser/decoration-links.mjs'
const url=ref(''),error=ref('')
onLoad(query=>{let value='';try{value=decodeURIComponent(query?.url||'')}catch{}if(isDecorationWebUrl(value))url.value=value;else error.value='网页地址无效'})
</script>
<template><page-meta :page-style="clientThemeStyle"/><web-view v-if="url&&!error" :src="url" @error="error='网页暂时无法打开，请联系站点管理员检查业务域名配置'"/><view v-else class="webview-error">{{error}}</view></template>
<style scoped>.webview-error{padding:32px 24px;color:#64748b;font-size:14px;line-height:1.8;text-align:center}</style>
