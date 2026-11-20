<script lang="ts">
export default {options:{styleIsolation:'shared'}}
</script>
<script setup lang="ts">
import ClientMaintenanceNotice from './ClientMaintenanceNotice.vue'
import DecorationAction from './DecorationAction.vue'
import DecorationCollection from './DecorationCollection.vue'
import DecorationMembership from './DecorationMembership.vue'
import ClientBottomNavigation from './ClientBottomNavigation.vue'
import DecorationFramework from './DecorationFramework.vue'
import DecorationImagePlaceholder from './DecorationImagePlaceholder.vue'
import DecorationProfile from './DecorationProfile.vue'
import {ref,onMounted,nextTick,provide,computed} from 'vue'
import type {CustomerServiceConfig,DecorationBlock,DecorationApplicationComponent,DecorationRoute,DecorationLink,DecorationScheme,DecorationMember,DecorationProfile as ProfileIdentity} from '@qicore/application-sdk/browser/decoration-types'
import {decorationOuterStyle,decorationBlockStyle,decorationPageBackground,decorationTheme} from '@qicore/application-sdk/browser/decoration-contract.mjs'
import {galleryItems,galleryStyle,galleryItemStyle,galleryImageFit,galleryPlaceholder,decorationOptions,visibleDecorationItems} from '@qicore/application-sdk/browser/decoration-options.mjs'
import DecorationPageHeader from './DecorationPageHeader.vue'
import DecorationExtra from './DecorationExtra.vue'
import DecorationBanner from './DecorationBanner.vue'
import {collectionContent,decorationRenderGroups,immersiveDecoration,decorationUnitStyle,floatStyle,dividerStyle} from '@qicore/application-sdk/browser/decoration-components.mjs'
import DecorationLinks from './DecorationLinks.vue'
import DecorationNotice from './DecorationNotice.vue'
import NativeBannerAd from './NativeBannerAd.vue'
const props=defineProps<{defaultAvatar?:string|null;customerService?:CustomerServiceConfig;targets?:DecorationRoute[];initialQuery?:string;focusCollection?:boolean;components?:DecorationApplicationComponent[];scheme:DecorationScheme;page:'home'|'profile';images:Record<string,string>;member?:DecorationMember|null;profile?:ProfileIdentity|null;nativeAdUnitId?:string}>()
provide('qicore-customer-service',computed(()=>props.customerService))
const nativeAdVisible=ref(true)
const renderGroups=computed(()=>decorationRenderGroups(props.scheme[props.page].blocks))
const emit=defineEmits<{navigate:[target:DecorationLink,root?:boolean]}>()
const nativeStyle=(style:Record<string,unknown>)=>decorationUnitStyle(style,true)
const style=(b:DecorationBlock)=>nativeStyle({...decorationBlockStyle(b,props.scheme,id=>props.images[id]||''),...(b.type==='float'?{margin:0,padding:0,background:'transparent'}:['membership','member-level','member-overview'].includes(b.type)?{background:'transparent',borderRadius:'0'}:{})})
const searchQuery=ref(props.initialQuery||''),activeTarget=ref<string>(props.page),pageScroll=ref(0),scrollTarget=ref('')
let currentScrollTop=0
function rememberScroll(event:{detail:{scrollTop:number}}){currentScrollTop=event.detail.scrollTop}
function search(value:string){
 searchQuery.value=value.trim().slice(0,64)
 if(import.meta.env.UNI_PLATFORM==='h5'){void nextTick(()=>uni.pageScrollTo({selector:'.collection',duration:200,fail:()=>{}}));return}
 const block=props.scheme[props.page].blocks.find(b=>b.enabled&&(b.type==='collection'||props.components?.some(c=>c.type===b.type&&c.renderer==='collection')))
 scrollTarget.value='';void nextTick(()=>{scrollTarget.value=block?'diy-block-'+block.id:''})
}
function go(target:DecorationLink,root=false){
 const route=props.targets?.find(r=>r.key===target),prefix='/pages/'+props.page+'/index?'
 if(route?.path.startsWith(prefix)){const values=Object.fromEntries(route.path.slice(prefix.length).split('&').map(pair=>{const [key,value='']=pair.split('=');return[key,decodeURIComponent(value)]}));activeTarget.value=String(target);search(values.query||'');return}
 if(target===props.page){searchQuery.value='';activeTarget.value=props.page;if(import.meta.env.UNI_PLATFORM==='h5')uni.pageScrollTo({scrollTop:0,duration:200});else{scrollTarget.value='';pageScroll.value=currentScrollTop;void nextTick(()=>{pageScroll.value=0})}return}
 emit('navigate',target,root)
}
onMounted(()=>{if(props.focusCollection||props.initialQuery)search(props.initialQuery||'')})
const location=ref('')
function locate(){uni.chooseLocation({success:place=>{location.value=place.name||place.address},fail:()=>uni.showToast({title:'未选择位置',icon:'none'})})}
function outerStyle(b:DecorationBlock,membership?:DecorationBlock){const memberOuter=membership?decorationOuterStyle(membership,props.scheme):null;return nativeStyle({...decorationOuterStyle(b,props.scheme),...(memberOuter?{paddingTop:memberOuter.paddingTop,paddingLeft:memberOuter.paddingLeft,paddingRight:memberOuter.paddingRight}:{}),...(b.type==='float'?floatStyle(b,props.scheme.navigation.enabled):{})})}
</script>
<template><view class="diy-page qc-view" :style="{background:decorationPageBackground(scheme,page),'--client-primary':decorationTheme(scheme).primary,'--client-background':decorationTheme(scheme).background,'--client-muted':decorationTheme(scheme).muted,'--client-text':decorationTheme(scheme).text}">
<!-- #ifdef MP-WEIXIN -->
<scroll-view class="diy-page-scroll" scroll-y enhanced :show-scrollbar="false" :scroll-top="pageScroll" :scroll-into-view="scrollTarget" :scroll-with-animation="true" @scroll="rememberScroll">
<!-- #endif -->
<ClientMaintenanceNotice/><DecorationPageHeader :query="searchQuery" @search="search" :theme="decorationTheme(scheme)" :page="{...scheme[page],showHeader:page==='home'&&scheme[page].showHeader}" :images="images" :immersive="immersiveDecoration(scheme,page)" @navigate="go($event)"/>
<view class="diy-content qc-view" :class="{'has-navigation':scheme.navigation.enabled}"><template v-for="{block,membership} in renderGroups" :key="block.id"><view v-if="block.enabled&&(block.type!=='wechat-ad'||!!nativeAdUnitId)" v-show="block.type!=='wechat-ad'||nativeAdVisible" class="diy-block-outer qc-view" :id="'diy-block-'+block.id" :style="outerStyle(block,membership)"><view class="diy-block qc-view" :style="style(block)"><template v-if="membership"><view class="joined-member qc-view"><DecorationMembership merged :block="{...membership,options:{...membership.options,memberRadius:0}}" :member="member" :images="images" :primary="decorationTheme(scheme).primary" @navigate="go($event)"/></view><DecorationMembership merged :block="block" :member="member" :images="images" :primary="decorationTheme(scheme).primary" @navigate="go($event)"/></template><DecorationFramework v-else-if="['intro','features','orders'].includes(block.type)" :block="block" :images="images" @navigate="go($event)"/><DecorationProfile v-else-if="block.type==='profile'" :block="block" :profile="profile" :default-avatar="defaultAvatar" :member="member" :images="images"  @navigate="go($event)"/><view v-else-if="block.type==='spacer'" :style="{height:block.height*2+'rpx'}" class="qc-view"/><view v-else-if="block.type==='divider'" class="diy-divider qc-view" :style="nativeStyle(dividerStyle(block))"/><DecorationExtra v-else-if="['text','hot-area','rich-text','assets','membership','member-level','member-overview','activity','search-box','search','float','showcase'].includes(block.type)" :block="block" :images="images" :member="member" :primary="decorationTheme(scheme).primary" :location="location" @locate="locate" @search="search" :query="searchQuery" @navigate="go($event)"/><DecorationNotice v-else-if="block.type==='notice'" :block="block" :images="images" :primary="decorationTheme(scheme).primary" @navigate="go($event)"/><DecorationAction :target="block.target" v-else-if="block.type==='button'" root-class="diy-cta" role="button" @click="go(block.target)">{{block.title||'按钮'}}</DecorationAction><DecorationAction :target="block.target" root-class="decoration-image-action" v-else-if="block.type==='image'" @click="go(block.target)"><image  class="diy-image qc-image" :src="block.imageId&&images[block.imageId]?images[block.imageId]:'/static/decoration/image-placeholder.svg'" mode="widthFix" :aria-label="block.title" /></DecorationAction>
<NativeBannerAd v-else-if="block.type==='wechat-ad'" :unit-id="nativeAdUnitId||''" @visible="nativeAdVisible=$event"/><DecorationBanner v-else-if="block.type==='banner'" :block="block" :images="images" @navigate="go($event)"/>
<view v-else-if="block.type==='gallery'" class="diy-gallery qc-view" :style="nativeStyle(galleryStyle(block))"><DecorationAction :target="item.target" v-for="(item,index) in galleryItems(block)" :key="item.id" :root-style="nativeStyle(galleryItemStyle(block,index))" role="button" :aria-label="item.label" tabindex="0" @keydown.enter="go(item.target)" @keydown.space.prevent="go(item.target)" @click="go(item.target)"><image v-if="item.imageId&&images[item.imageId]||item.builtin&&images[item.builtin]" :src="images[(item.imageId||item.builtin)!]" :mode="galleryImageFit(block)==='contain'?'aspectFit':'aspectFill'" :aria-label="item.label" class="qc-image"/><DecorationImagePlaceholder v-else :compact="galleryPlaceholder(block,index).compact" :size="galleryPlaceholder(block,index).size"/></DecorationAction></view><DecorationLinks v-else-if="block.type==='links'" :block="block" :images="images" @navigate="go($event)"/><DecorationCollection v-else-if="block.type==='collection'||components?.some(c=>c.type===block.type&&c.renderer==='collection')" :block="block" :component="collectionContent(block,components)" :images="images" :query="searchQuery"  @navigate="go($event)"/><slot v-else :block="block"/></view></view></template></view>
<!-- #ifdef MP-WEIXIN -->
</scroll-view>
<!-- #endif -->
<ClientBottomNavigation :scheme="scheme" :images="images" :active-target="activeTarget" @navigate="go"/></view></template>
<style scoped>.diy-page{font-family:var(--client-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif);position:relative;min-height:100dvh;color:#172554;font-size:14px}.diy-content{padding:0}.diy-content.has-navigation{padding-bottom:calc(62px + env(safe-area-inset-bottom))}.diy-block-outer{display:grid;min-width:0}.joined-member{position:relative}.joined-member::before{content:"";position:absolute;left:32rpx;right:32rpx;bottom:0;height:2rpx;background:#edf2f7;pointer-events:none}.diy-block{overflow:hidden;overflow-wrap:anywhere}.diy-heading{font-size:1.07em;font-weight:600;line-height:inherit}.diy-text{white-space:pre-wrap;margin-top:8px;line-height:inherit}.diy-image{width:100%;display:block}.diy-slide{width:100%;height:100%}.diy-gallery>.qc-view{width:100%;height:100%}.diy-gallery .qc-image{display:block;width:100%;height:100%}.diy-banner{position:relative;overflow:hidden}.banner-dots{position:absolute;bottom:0;left:0;right:0}.diy-cta{text-align:center;font-weight:600;min-height:24px}.diy-divider{border-top:1px solid;margin:0}</style>

<style scoped>.decoration-image-action{display:block;width:100%;height:100%;line-height:0}</style>

<style scoped>
/* #ifdef MP-WEIXIN */
.diy-page{height:100vh;min-height:0;display:flex;flex-direction:column;overflow:hidden}.diy-page-scroll{height:0;min-height:0;flex:1}
/* #endif */
</style>
