<script lang="ts">
export default {options:{styleIsolation:'shared'}}
</script>
<script setup lang="ts">
import {computed,ref} from 'vue'
import {onShow,onHide,onUnload} from '@dcloudio/uni-app'
import DecorationAction from './DecorationAction.vue'
import {frameworkAsset,decorationIcons} from '@qicore/application-sdk/browser/decoration-framework.mjs'
import {decorationNavigation,normalizeDecorationScheme} from '@qicore/application-sdk/browser/decoration-contract.mjs'
import type {DecorationScheme,DecorationLink,DecorationRoute,DecorationApplicationAssets} from '@qicore/application-sdk/browser/decoration-types'
import {api,isH5,message} from '../lib/api'
import {runtimeConfig} from '../lib/runtime-config'
import {decorationScope,navigateDecoration} from '../lib/decoration'
const props=defineProps<{scheme?:DecorationScheme;images?:Record<string,string>;activeTarget:string;inline?:boolean}>()
const emit=defineEmits<{navigate:[target:DecorationLink,root:boolean]}>()
const loaded=ref<{scheme:DecorationScheme;images:Record<string,string>;targets:DecorationRoute[]}>(),error=ref(''),loading=ref(false)
let sequence=0,visible=true,alive=true,owner=''
const scheme=computed(()=>props.scheme||loaded.value?.scheme),images=computed(()=>props.images||loaded.value?.images||{}),colors=computed(()=>scheme.value?decorationNavigation(scheme.value):null)
const navIcon=(name:string|undefined,target:DecorationLink,selected:boolean)=>{const icon=decorationIcons.includes(name||'')?name:target==='home'?'house':target==='profile'?'user-round':'layout-grid';return(isH5?'/h5-assets':'')+frameworkAsset('icons/'+icon+(selected?'-blue':'')+'.svg',true)}
async function load(){
 if(props.scheme||loading.value||!alive||!visible)return
 const scope=decorationScope(),attempt=++sequence,runtime=runtimeConfig();if(owner!==scope)loaded.value=undefined
 owner=scope;loading.value=true;error.value=''
 try{
  const query='tenantId='+encodeURIComponent(runtime.tenantId)+'&applicationKey='+encodeURIComponent(runtime.applicationKey),value=await api<{imageUrls?:Record<string,string>;scheme:DecorationScheme;targets:DecorationRoute[];assets?:DecorationApplicationAssets}>('/public/client/decoration?'+query)
  if(!alive||!visible||attempt!==sequence||scope!==decorationScope())return
  const normalized=normalizeDecorationScheme(value.scheme),resolved:Record<string,string>={}
  for(const item of normalized.navigation.items){
   for(const name of [item.builtin,item.selectedBuiltin]){const asset=name&&value.assets?.[name];if(name&&asset)resolved[name]=isH5?new URL(asset.web,location.origin).href:asset.client}
   if(item.imageId){const path=value.imageUrls?.[item.imageId]||runtime.apiBase+'/public/client/images/'+encodeURIComponent(item.imageId)+'?'+query;resolved[item.imageId]=isH5?new URL(path,location.origin).href:path}
  }
  loaded.value={scheme:normalized,images:resolved,targets:value.targets}
 }catch(e){if(alive&&visible&&attempt===sequence&&scope===decorationScope())error.value=message(e)}finally{if(alive&&attempt===sequence)loading.value=false}
}
function go(target:DecorationLink){if(props.scheme){emit('navigate',target,true);return}if(owner!==decorationScope()){loaded.value=undefined;void load();return}if(target!==props.activeTarget)navigateDecoration(target,props.activeTarget,loaded.value?.targets,true)}
function hide(){visible=false;sequence++;loading.value=false}
onShow(()=>{visible=true;if(!props.scheme)void load()});onHide(hide);onUnload(()=>{hide();alive=false;loaded.value=undefined})
</script>
<template>
 <view v-if="scheme?.navigation.enabled&&colors" class="diy-navigation qc-view" :class="{inline}" :style="{background:colors.background}" role="navigation" aria-label="底部导航">
  <DecorationAction v-for="item in scheme.navigation.items" :key="item.id" :target="item.target" root-class="diy-nav-item" role="button" :aria-label="item.label" :aria-current="item.target===activeTarget?'page':undefined" :root-style="{color:item.target===activeTarget?colors.selectedColor:colors.color}" @click="go(item.target)">
   <image v-if="item.imageId&&images[item.imageId]||item.builtin&&images[item.builtin]" class="diy-nav-icon qc-image" :src="item.imageId?images[item.imageId]:images[item.target===activeTarget&&item.selectedBuiltin?item.selectedBuiltin:item.builtin!]" mode="aspectFit"/>
   <template v-else>
   <!-- #ifdef H5 -->
   <view class="diy-nav-icon diy-nav-symbol qc-view" :style="{maskImage:'url('+navIcon(item.icon,item.target,false)+')',WebkitMaskImage:'url('+navIcon(item.icon,item.target,false)+')'}"/>
   <!-- #endif -->
   <!-- #ifndef H5 -->
   <image class="diy-nav-icon qc-image" :src="navIcon(item.icon,item.target,item.target===activeTarget)" mode="aspectFit"/>
   <!-- #endif -->
   </template>
   <text class="qc-text">{{item.label}}</text>
  </DecorationAction>
 </view>
 <view v-else-if="error" class="navigation-error qc-view"><text class="qc-text">导航读取失败</text><button role="button" :disabled="loading" @click="load" class="qc-button">重新加载</button></view>
</template>
<style scoped>
.diy-navigation{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:space-around;align-items:center;height:calc(50px + env(safe-area-inset-bottom));box-sizing:border-box;padding:4px 6px calc(4px + env(safe-area-inset-bottom));border-top:1px solid #e2e8f0;z-index:10}.diy-navigation.inline{position:relative;flex-shrink:0;width:100%;max-width:none;margin-inline:0}.diy-nav-item{display:flex;flex-direction:column;align-items:center;min-width:0;flex:1;gap:2px;font-size:10px;line-height:14px}.diy-nav-item>.qc-text{max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.diy-nav-symbol{background:currentColor;mask-size:contain;mask-repeat:no-repeat;mask-position:center;-webkit-mask-size:contain;-webkit-mask-repeat:no-repeat;-webkit-mask-position:center}.diy-nav-icon{display:block;width:22px;height:22px;flex-shrink:0}.navigation-error{position:relative;display:flex;align-items:center;justify-content:center;gap:8px;padding:8px;font-size:12px;background:#fff;color:#78889e}.navigation-error .qc-button{margin:0;padding:5px 10px;border:0;background:transparent;font:inherit;color:var(--client-primary)}.navigation-error .qc-button::after{border:0}
</style>
