<script setup lang="ts">
import {clientImageDomain} from '../../lib/runtime-config'
import {readLoadedPages} from '../../lib/read-loaded-pages'
import {useMaintenanceReload} from '../../lib/maintenance'
import ClientPageState from '../../components/ClientPageState.vue'
import {clientThemeStyle} from '../../lib/client-theme'
import {ref} from 'vue'
import {onLoad,onShow,onUnload} from '@dcloudio/uni-app'
import ClientNavigation from '../../components/ClientNavigation.vue'
import MpHtml from 'mp-html/dist/uni-app/components/mp-html/mp-html.vue'
import {helpEndpoint,loadHelp,loadHelpArticle,type HelpListing,type HelpCategory} from '../../lib/help'
import {isClientPreview,message} from '../../lib/api'
const category=ref(''),categories=ref<HelpCategory[]>([]),data=ref<HelpListing|null>(null),demo=ref(false),busy=ref(''),error=ref(''),expanded=ref(''),answerBusy=ref(''),answerError=ref(''),answers=ref<Record<string,string>>({})
let sequence=0,answerSequence=0,disposed=false,dataScope='',retryPage=1
function clearAnswers(){expanded.value='';answerSequence++;answerBusy.value='';answerError.value='';answers.value={}}
async function load(action='initial',page=1){
 const scope=helpEndpoint()
 if(busy.value&&!action.startsWith('category:')&&scope===dataScope)return
 const attempt=++sequence,preview=demo.value;busy.value=action;if(action!=='retry')error.value=''
 if(dataScope!==scope){data.value=null;categories.value=[];category.value='';page=1;dataScope=scope}
 retryPage=page;if(page===1&&!data.value)clearAnswers()
 try{const readPage=(page:number)=>loadHelp({...(category.value?{categoryId:category.value}:{}),page},preview);const value=action==='maintenance'?await readLoadedPages(readPage,data.value?.page||1,()=>!disposed&&attempt===sequence&&scope===helpEndpoint()):await readPage(page);if(!value)return;if(disposed||attempt!==sequence)return;if(scope!==helpEndpoint()||preview!==demo.value){data.value=null;categories.value=[];clearAnswers();error.value='站点已变化，请重新读取帮助内容';return}categories.value=value.categories;data.value={...value,items:action!=='maintenance'&&page>1&&value.page===page?[...(data.value?.items||[]),...value.items]:value.items};error.value=''}
 catch(e){if(!disposed&&attempt===sequence){error.value=message(e);if(scope!==helpEndpoint()){data.value=null;categories.value=[];clearAnswers()}}}
 finally{if(!disposed&&attempt===sequence)busy.value=''}
}
function select(id:string){if(category.value===id)return;category.value=id;data.value=null;clearAnswers();void load('category:'+id)}
function more(){if(!busy.value&&data.value)void load('more',data.value.page+1)}
function retry(){void load('retry',retryPage)}
async function open(id:string,retry=false){
 if(dataScope!==helpEndpoint()){void load('scope');return}
 const item=data.value?.items.find(item=>item.id===id);if(!item)return
 if(!retry&&expanded.value===id){expanded.value='';answerSequence++;answerBusy.value='';answerError.value='';return}
 if(retry&&answerBusy.value)return
 expanded.value=id;if(!retry)answerError.value='';const attempt=++answerSequence,scope=dataScope;answerBusy.value=''
 if(item.content!==undefined){answers.value[id]=item.content;return}if(answers.value[id]!==undefined)return
 answerBusy.value=id
 try{const article=await loadHelpArticle(id);if(!disposed&&attempt===answerSequence&&expanded.value===id){if(scope!==helpEndpoint()){data.value=null;categories.value=[];clearAnswers();error.value='站点已变化，请重新读取帮助内容';return}answers.value[id]=article.content;answerError.value=''}}
 catch(e){if(!disposed&&attempt===answerSequence&&expanded.value===id){if(scope!==helpEndpoint()){data.value=null;categories.value=[];clearAnswers();error.value='站点已变化，请重新读取帮助内容'}else answerError.value=message(e)}}
 finally{if(!disposed&&attempt===answerSequence)answerBusy.value=''}
}
onLoad(options=>{demo.value=!!isClientPreview&&options?.demo==='1';void load()});onShow(()=>{if(dataScope&&dataScope!==helpEndpoint())void load('scope')});onUnload(()=>{disposed=true;sequence++;clearAnswers()})
useMaintenanceReload(async()=>{await load('maintenance');const id=expanded.value;if(id){delete answers.value[id];await open(id,true)}},()=>!!busy.value||!!answerBusy.value)
</script>
<template><page-meta :page-style="clientThemeStyle"/><view class="help-page">
 <ClientNavigation title="帮助中心" back/>
 <scroll-view enhanced scroll-y class="help-scroll" :show-scrollbar="false"><view class="help-body">
  <scroll-view enhanced v-if="categories.length" scroll-x class="help-categories" :show-scrollbar="false"><view class="help-category-row" role="tablist" aria-label="帮助分类"><button role="tab" :aria-selected="!category" :aria-busy="busy==='category:'" :class="{chosen:!category}" @click="select('')">全部</button><button v-for="item in categories" :key="item.id" role="tab" :aria-selected="category===item.id" :aria-busy="busy==='category:'+item.id" :class="{chosen:category===item.id}" @click="select(item.id)">{{item.name}}</button></view></scroll-view>
  <ClientPageState v-if="error&&retryPage===1&&!data" kind="error" title="帮助内容暂时无法加载" :description="error" action-label="重新加载" :loading="busy==='retry'" :disabled="!!busy" @action="retry"/>
  <view v-if="busy&&retryPage===1&&!error&&!data" class="help-state" role="status">正在读取帮助内容…</view>
  <view v-else-if="data?.items.length" class="qa-list"><view v-for="item in data.items" :key="item.id" class="qa-item">
   <button role="button" class="qa-question" :aria-expanded="expanded===item.id" :aria-controls="'answer-'+item.id" @click="open(item.id)"><text class="qa-title">{{item.title}}</text><text class="qa-toggle" aria-hidden="true">{{expanded===item.id?'−':'+'}}</text></button>
   <view v-if="expanded===item.id" :id="'answer-'+item.id" class="qa-answer"><view class="qa-content"><view v-if="answerError" role="alert">{{answerError}}<button role="button" :loading="answerBusy===item.id" :disabled="!!answerBusy" @click="open(item.id,true)">重试</button></view><text v-else-if="answerBusy===item.id" role="status">正在读取答案…</text><mp-html :domain="clientImageDomain()" v-else :content="answers[item.id]||''" :copy-link="false" :selectable="true" :tag-style="{img:'max-width:100%;height:auto;',table:'max-width:100%;'}"/></view></view>
  </view></view>
  <view v-else-if="!error&&!busy" class="help-state">{{category?'该分类暂无问答':'暂无帮助内容'}}</view>
  <view v-if="error&&(retryPage>1||data)" class="help-error help-more-error" role="alert">{{error}}<button role="button" :loading="busy==='retry'" :disabled="!!busy" @click="retry">重新加载</button></view>
  <button v-if="!error&&!(busy&&retryPage===1)&&data&&data.items.length<data.total" role="button" class="more-button" :loading="busy==='more'" :disabled="!!busy" @click="more">加载更多</button>
 </view></scroll-view>
</view></template>
<style scoped>
.help-page{display:flex;flex-direction:column;height:100dvh;max-width:480px;margin:auto;background:var(--client-page-background, #f3f9ff);color:var(--client-text);font:14px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif}.help-page button{box-sizing:border-box;margin:0;padding:0;border:0;background:transparent;color:inherit;font:inherit}.help-page button::after{border:0}.help-scroll{flex:1;min-height:0;height:0}.help-body{padding:var(--client-content-top, 16px) var(--client-page-gutter, 10px) calc(24px + env(safe-area-inset-bottom))}.demo-label{font-size:11px;color:var(--client-muted);margin:0 2px 14px}.help-categories{white-space:nowrap;margin-bottom:16px}.help-category-row{display:inline-flex;gap:8px}.help-category-row button{padding:7px 13px;border-radius:8px;font-size:12px;color:var(--client-muted)}.help-category-row button.chosen{background:var(--client-primary-soft);color:var(--client-primary);font-weight:600}.qa-list{padding:0 16px;border-radius:14px;background:var(--client-surface)}.qa-item+.qa-item{border-top:1px solid #eef1f6}.qa-question{display:flex;align-items:flex-start;gap:10px;width:100%;padding:18px 0!important;text-align:left;line-height:1.7}.qa-title{flex:1;min-width:0;overflow-wrap:anywhere;font-size:14px;font-weight:600}.qa-toggle{flex-shrink:0;width:16px;text-align:center;font-size:18px;color:var(--client-muted);line-height:24px}.qa-answer{padding:0 24px 18px 0}.qa-content{flex:1;min-width:0;overflow:hidden;overflow-wrap:anywhere;color:var(--client-muted);font-size:13px;line-height:1.8}.qa-content button{display:block;margin-top:10px;color:var(--client-primary);font-size:12px}.help-state{padding:60px 16px;text-align:center;color:var(--client-muted);font-size:14px}.help-error{padding:14px;border-radius:12px;background:#fff0ef;color:#b84039;font-size:13px}.help-error button{display:block;margin-top:8px}.help-page .more-button{width:100%;margin-top:16px;min-height:40px;color:var(--client-primary);font-size:13px}
</style>
<style scoped>.help-category-row button{flex-shrink:0;white-space:nowrap}.help-more-error{margin-top:16px}.help-page button[disabled]{opacity:1}</style>
