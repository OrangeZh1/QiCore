<script setup lang="ts">
import {clientImageDomain} from '../../lib/runtime-config'
import {useMaintenanceReload} from '../../lib/maintenance'
import {clientThemeStyle} from '../../lib/client-theme'
import {ref} from 'vue'
import {onLoad,onUnload} from '@dcloudio/uni-app'
import MpHtml from 'mp-html/dist/uni-app/components/mp-html/mp-html.vue'
import ClientNavigation from '../../components/ClientNavigation.vue'
import {loadHelpArticle,type HelpArticle} from '../../lib/help'
import {message} from '../../lib/api'
const id=ref(''),article=ref<(HelpArticle&{content:string})|null>(null),busy=ref(''),error=ref('');let disposed=false,sequence=0,readingId=''
async function load(action='initial'){if(busy.value&&readingId===id.value)return;const attempt=++sequence;readingId=id.value;busy.value=action;if(action!=='retry')error.value='';article.value=null;try{const value=await loadHelpArticle(id.value);if(!disposed&&attempt===sequence){article.value=value;error.value=''}}catch(e){if(!disposed&&attempt===sequence)error.value=message(e)}finally{if(!disposed&&attempt===sequence)busy.value=''}}
onLoad(options=>{id.value=String(options?.id||'');void load()});onUnload(()=>{disposed=true;sequence++;article.value=null})
useMaintenanceReload(()=>load('maintenance'),()=>!!busy.value)
</script>
<template><page-meta :page-style="clientThemeStyle"/><view class="help-detail"><ClientNavigation title="帮助详情" back fallback="/pages/help/index"/><scroll-view enhanced scroll-y class="article-scroll" :show-scrollbar="false"><view class="article-body"><view v-if="error" class="article-error" role="alert">{{error}}<button role="button" :loading="busy==='retry'" :disabled="!!busy" @click="load('retry')">重试</button></view><view v-else-if="busy" class="article-state" role="status">正在读取文章…</view><view v-else-if="article" class="help-article"><view class="article-title">{{article.title}}</view><view class="article-category">{{article.category.name}}</view><mp-html :domain="clientImageDomain()" :content="article.content" :copy-link="false" :selectable="true" :tag-style="{img:'max-width:100%;height:auto;',table:'max-width:100%;'}"/></view></view></scroll-view></view></template>
<style scoped>.help-detail{display:flex;flex-direction:column;height:100dvh;max-width:480px;margin:auto;background:var(--client-page-background, #f3f9ff);color:var(--client-text);font:14px/1.8 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif}.article-scroll{flex:1;min-height:0;height:0}.article-body{padding:var(--client-content-top, 16px) var(--client-page-gutter, 10px) calc(24px + env(safe-area-inset-bottom))}.help-article{padding:20px 16px;background:var(--client-surface);border-radius:14px;overflow-wrap:anywhere;overflow:hidden}.article-title{font-size:20px;font-weight:600;line-height:1.5}.article-category{margin:12px 0 20px;padding-bottom:14px;border-bottom:1px solid #edf0f5;font-size:12px;color:var(--client-muted)}.article-state{padding:60px 16px;text-align:center;color:var(--client-muted)}.article-error{padding:14px;border-radius:12px;background:#fff0ef;color:#b84039;font-size:13px}.article-error button{display:block;margin:8px 0 0;padding:8px 0;border:0;background:transparent;color:inherit;font:inherit}.article-error button::after{border:0}</style>
