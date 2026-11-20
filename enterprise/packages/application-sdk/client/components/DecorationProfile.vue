<script lang="ts">
export default {options:{styleIsolation:'shared'}}
</script>
<script setup lang="ts">
import DecorationAction from './DecorationAction.vue'
import {computed,ref,watch} from 'vue'
import {clientImageUrl} from '../lib/runtime-config'
import type {DecorationBlock,DecorationProfile,DecorationLink,DecorationMember} from '@qicore/application-sdk/browser/decoration-types'
import {frameworkAsset as sharedFrameworkAsset} from '@qicore/application-sdk/browser/decoration-framework.mjs'
import {decorationOptions} from '@qicore/application-sdk/browser/decoration-options.mjs'
import {decorationProfile} from '@qicore/application-sdk/browser/decoration-components.mjs'
const frameworkAsset=(name:string)=>(import.meta.env.UNI_PLATFORM==='h5'?'/h5-assets':'')+sharedFrameworkAsset(name,true)
const props=defineProps<{defaultAvatar?:string|null;block:DecorationBlock;profile?:DecorationProfile|null;member?:DecorationMember|null;editable?:boolean;images:Record<string,string>}>()
defineEmits<{navigate:[target:DecorationLink]}>()
const o=computed(()=>decorationOptions(props.block))
const identity=computed(()=>decorationProfile(props.profile))
const source=computed(()=>clientImageUrl(identity.value.avatar||props.defaultAvatar)),failedSource=ref('')
const avatar=computed(()=>source.value&&source.value!==failedSource.value?source.value:frameworkAsset('avatar.png'))
watch(source,()=>{failedSource.value=''})
function avatarFailed(event:Event|{currentTarget?:{dataset?:{avatarSource?:string}}}){const target=event.currentTarget as {dataset?:{avatarSource?:string}}|null|undefined;if(source.value&&target?.dataset?.avatarSource===source.value)failedSource.value=source.value}
const memberLabel=computed(()=>props.member?.level?.name||'普通会员')
</script>
<template><DecorationAction :target="block.target" :native-disabled="editable" role="button" :root-class="['fw-control profile-header',{center:o.profileLayout==='center','profile-banner':o.profileLayout==='banner'}]"  :root-style="o.profileLayout==='banner'?{minHeight:o.profileHeight*2+'rpx',backgroundImage:'url('+(block.imageId?images[block.imageId]:frameworkAsset('intro.png'))+')'}:{}" :disabled="editable||!block.target" @click="$emit('navigate',block.target)"><view v-if="o.showAvatar" class="fw-span profile-avatar qc-view"><image mode="aspectFit" :src="avatar" :data-avatar-source="source" @error="avatarFailed" alt="用户头像" class="qc-image"/></view><view class="fw-span profile-info qc-view"><view class="fw-span profile-name-row qc-view"><view class="fw-strong qc-view">{{identity.name}}</view><DecorationAction v-if="profile" :target="profile?'system:member-levels':block.target" :native-disabled="editable" root-class="fw-span profile-badge" role="button" :aria-label="profile?'查看会员等级':'登录'" tabindex="0" @click.stop="$emit('navigate',profile?'system:member-levels':block.target)" @keydown.enter.stop="$emit('navigate',profile?'system:member-levels':block.target)">{{memberLabel}}</DecorationAction></view><view v-if="o.showAccount&&identity.account" class="fw-span profile-detail qc-view">账号：{{identity.account}}</view><view v-if="o.showMemberNumber&&identity.memberNumber" class="fw-span profile-detail qc-view">ID：{{identity.memberNumber}}</view></view></DecorationAction></template>
<style scoped>
.profile-header{display:flex;align-items:center;gap:28rpx;width:100%;min-height:116rpx;border:0;padding:0;background:none;color:inherit;font:inherit;text-align:inherit;cursor:pointer}.profile-header:disabled{opacity:1;cursor:inherit}.profile-avatar{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:120rpx;height:120rpx;border-radius:50%;overflow:hidden;background:#e2e8f0;color:#64748b;font-size:60rpx}.profile-avatar .qc-image{width:100%;height:100%;object-fit:cover}.profile-info{display:flex;flex-direction:column;gap:10rpx;flex:1;min-width:0;overflow-wrap:anywhere}.profile-info .fw-strong{font-size:36rpx;font-weight:600}.profile-detail{font-size:24rpx;opacity:.7}.center{flex-direction:column;gap:20rpx}
.profile-banner .profile-avatar{width:128rpx;height:128rpx;border:4rpx solid #ffffffb3;box-shadow:0 8rpx 28rpx #5273a017}.profile-banner .profile-info .fw-strong{font-size:40rpx}</style>
<style scoped>.profile-banner{padding:80rpx 40rpx 128rpx;background-size:cover;background-position:center;min-height:380rpx;box-sizing:border-box}.profile-name-row{display:flex;align-items:center;gap:20rpx;flex-wrap:wrap}.profile-badge{padding:4rpx 16rpx;background:#eff6ff;color:#2563eb;font-size:22rpx;border-radius:16rpx}.center .profile-name-row{justify-content:center}.profile-avatar{background:#edf5ff;width:116rpx;height:116rpx}</style>
