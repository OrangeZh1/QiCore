<script lang="ts">
const dialogStack:HTMLElement[]=[]
let bodyOverflow=''
</script>
<script setup lang="ts">
import {ref,onMounted,onBeforeUnmount,nextTick} from 'vue'
import {isH5} from '../lib/api'
const props=defineProps<{title:string;busy?:boolean;suspended?:boolean;presentation?:'dialog'|'sheet';closeIcon?:string;persistent?:boolean;blurBackdrop?:boolean}>()
const emit=defineEmits<{close:[]}>(),panel=ref<any>(null),overlay=ref<any>(null)
let previous:HTMLElement|null=null
const inertSiblings=new Map<HTMLElement,boolean>()
const element=()=>(panel.value?.$el||panel.value) as HTMLElement|undefined
function close(){if(!props.busy&&!props.persistent)emit('close')}
function focusInside(){if(props.suspended||dialogStack.at(-1)!==element())return;if(!element()?.contains(document.activeElement))element()?.focus()}
function keyboard(event:KeyboardEvent){
 if(props.suspended||dialogStack.at(-1)!==element())return
 if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();return}
 if(event.key!=='Tab')return
 const items=Array.from(element()?.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled),[tabindex="0"]')||[]).filter(item=>!item.hasAttribute('disabled')&&item.offsetParent!==null)
 const first=items[0],last=items.at(-1)
 if(!first){event.preventDefault();element()?.focus();return}
 if(event.shiftKey&&(document.activeElement===first||!element()?.contains(document.activeElement))){event.preventDefault();last?.focus()}
 else if(!event.shiftKey&&(document.activeElement===last||!element()?.contains(document.activeElement))){event.preventDefault();first.focus()}
}
onMounted(async()=>{if(!isH5)return;previous=document.activeElement as HTMLElement;if(!dialogStack.length)bodyOverflow=document.body.style.overflow;document.body.style.overflow='hidden';await nextTick();const target=element();if(!target)return;dialogStack.push(target);
 if(props.persistent){let current=(overlay.value?.$el||overlay.value) as HTMLElement;while(current?.parentElement){for(const sibling of Array.from(current.parentElement.children))if(sibling!==current&&sibling instanceof HTMLElement){inertSiblings.set(sibling,sibling.inert);sibling.inert=true}current=current.parentElement;if(current===document.body)break}}
 document.addEventListener('keydown',keyboard,true);document.addEventListener('focusin',focusInside,true);target.focus()})
onBeforeUnmount(()=>{if(!isH5)return;const index=dialogStack.indexOf(element()!);if(index>=0)dialogStack.splice(index,1);for(const [target,inert]of inertSiblings)target.inert=inert;if(!dialogStack.length)document.body.style.overflow=bodyOverflow;document.removeEventListener('keydown',keyboard,true);document.removeEventListener('focusin',focusInside,true);if(previous?.isConnected&&!previous.inert)previous.focus()})
</script>
<template>
 <view ref="overlay" class="client-dialog-overlay" :class="{'is-suspended':suspended,'is-sheet':presentation==='sheet','is-persistent':persistent,'blur-backdrop':blurBackdrop}">
  <view class="client-dialog-backdrop" @click="close" @wheel.stop.prevent @touchmove.stop.prevent/>
  <view ref="panel" class="client-dialog-panel" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1">
   <view class="client-dialog-header"><text class="client-dialog-title">{{title}}</text><button v-if="!persistent" role="button" tabindex="0" class="client-dialog-close" aria-label="关闭弹窗" :disabled="busy" @click="close" @keydown.enter.prevent="close"><image v-if="closeIcon" class="client-dialog-close-image" :src="closeIcon" mode="aspectFit"/><text v-else>×</text></button></view>
   <scroll-view enhanced scroll-y class="client-dialog-body" :show-scrollbar="false"><slot/></scroll-view>
   <view class="client-dialog-footer"><slot name="footer"/></view>
  </view>
 </view>
</template>
<style scoped>
.client-dialog-overlay{position:fixed;inset:0;z-index:900;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}.client-dialog-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.32)}.client-dialog-panel{position:relative;display:flex;flex-direction:column;width:100%;max-width:420px;max-height:calc(100dvh - 32px);border-radius:20px;background:var(--client-surface, #ffffff);overflow:hidden;box-shadow:0 12px 36px #172b4514;outline:none;color:var(--client-text, #1e293b);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}.client-dialog-header{position:relative;display:flex;align-items:center;justify-content:center;flex-shrink:0;min-height:64px;box-sizing:border-box;padding:22px 52px 16px}.client-dialog-title{font-size:18px;font-weight:600;line-height:26px;text-align:center}.client-dialog-close{position:absolute;right:10px;top:10px;display:flex;align-items:center;justify-content:center;width:44px;min-width:44px;height:44px;border:0;margin:0;padding:0;border-radius:50%;background:transparent;color:#8b98aa;font-size:26px;line-height:1}.client-dialog-close::after{border:0}.client-dialog-body{min-height:0;max-height:calc(100dvh - 156px);box-sizing:border-box;padding:0 20px 20px}.client-dialog-footer{flex-shrink:0;border-top:1px solid #edf0f5}.client-dialog-close:focus-visible{outline:2px solid var(--client-primary-border, #9bbcff);outline-offset:-4px}.is-suspended{pointer-events:none}
.client-dialog-close-image{width:24px;height:24px}.is-sheet{align-items:flex-end;padding:0}.is-sheet .client-dialog-panel{max-width:480px;max-height:85dvh;border-radius:20px 20px 0 0}.is-sheet .client-dialog-footer{padding:16px 20px calc(16px + env(safe-area-inset-bottom))}.is-sheet .client-dialog-body{max-height:calc(85dvh - 160px)}
.is-persistent{z-index:1100}.blur-backdrop .client-dialog-backdrop{background:rgba(15,23,42,.14);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}.client-dialog-panel,.client-dialog-body{overscroll-behavior:contain}.client-dialog-body :deep(.uni-scroll-view){overscroll-behavior:contain}.is-persistent .client-dialog-header{padding-inline:20px}
</style>
