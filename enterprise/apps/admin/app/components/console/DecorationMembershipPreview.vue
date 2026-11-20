<script setup lang="ts">
import {computed} from 'vue'
import {decorationOptions} from '../../../../api/src/core/decoration-options.mjs'
import type {DecorationBlock,DecorationMember,DecorationLink} from '../../../../api/src/core/decoration-types'
import {decorationIconUrl} from '../../../../api/src/core/decoration-framework.mjs'
import {memberCardContent,memberCardStyle,accountAssetItems,accountAssetStyle,decorationUnitStyle} from '../../../../api/src/core/decoration-components.mjs'
const props=defineProps<{merged?:boolean;block:DecorationBlock;member?:DecorationMember|null;editable?:boolean;primary:string;imageUrl:(id:string)=>string}>()
const emit=defineEmits<{navigate:[target:DecorationLink]}>()
const card=computed(()=>memberCardContent(props.block,props.member)),assets=computed(()=>accountAssetItems(props.member,props.block))
const assetOptions=computed(()=>decorationOptions(props.block)),assetStyle=computed(()=>decorationUnitStyle(accountAssetStyle(props.block,props.primary)))
const style=computed(()=>decorationUnitStyle(memberCardStyle(props.block,props.primary)))
const icon=computed(()=>props.block.imageId?props.imageUrl(props.block.imageId):!props.block.icon&&props.block.builtin?props.imageUrl(props.block.builtin):decorationIconUrl(props.block.icon||'crown').replace('.svg','-blue.svg'))
function navigate(target:DecorationLink){if(!props.editable&&target)emit('navigate',target)}
</script>
<template>
 <div v-if="block.type==='assets'" class="account-assets" :class="['asset-layout-'+assetOptions.assetLayout,{'one-asset':assets.length===1,'is-merged':merged}]" :style="assetStyle">
  <div v-if="assetOptions.assetTitle" class="asset-heading"><span class="asset-heading-title">{{block.title||'我的资产'}}</span><span v-if="block.text" class="asset-heading-description">{{block.text}}</span></div>
  <div class="asset-grid"><button v-for="asset in assets" :key="asset.key" type="button" class="asset-entry" :aria-label="asset.action+'，'+asset.label+' '+asset.value" @click="navigate(asset.target)">
   <div class="asset-top"><div v-if="assetOptions.assetIcons" class="asset-icon-wrap"><img class="asset-icon" :src="decorationIconUrl(asset.icon)" alt="" aria-hidden="true"/></div><span class="asset-label">{{asset.label}}</span><span class="asset-chevron" aria-hidden="true"/></div>
   <div class="asset-amount"><span class="asset-value">{{asset.value}}</span></div>
   <span class="asset-recharge" :class="{'is-primary':asset.key==='points'}"><span>{{asset.action}}</span><img v-if="assetOptions.assetLayout==='strip'" class="asset-recharge-arrow" :src="decorationIconUrl('chevron-right').replace('.svg','-blue.svg')" alt="" aria-hidden="true"/></span>
  </button></div>
 </div>
 <div v-else class="member-card" :class="{gold:block.options?.memberStyle==='gold','is-merged':merged}" :style="style">
  <div class="member-emblem"><img alt="" :src="icon" :class="{'builtin-icon':!block.imageId&&!block.builtin}"/></div>
  <div class="member-copy"><div class="member-title"><span>{{card.title}}</span><span v-if="member&&block.options?.showMemberStatus!==false" class="member-tag">{{card.levelName}}</span></div><div v-if="card.subtitle" class="member-description">{{card.subtitle}}</div></div>
  <button type="button" class="member-action" @click="navigate(card.target)">{{card.action}}<img v-if="merged" class="member-link-arrow" :src="decorationIconUrl('chevron-right').replace('.svg','-blue.svg')" alt="" aria-hidden="true"/><span v-else class="member-chevron" aria-hidden="true"/></button>
 </div>
</template>
<style scoped>
.member-card{display:flex;align-items:center;gap:calc(var(--diy-unit, 1px) * 8);min-height:calc(var(--diy-unit, 1px) * 58);padding:calc(var(--diy-unit, 1px) * 11) calc(var(--diy-unit, 1px) * 12);box-sizing:border-box;text-align:left;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif}.member-emblem{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:calc(var(--diy-unit, 1px) * 29);height:calc(var(--diy-unit, 1px) * 29);border-radius:calc(var(--diy-unit, 1px) * 9);background:var(--member-soft)}.member-emblem img{width:calc(var(--diy-unit, 1px) * 16);height:calc(var(--diy-unit, 1px) * 16)}.builtin-icon{filter:var(--member-icon-filter)}.member-copy{flex:1;min-width:0}.member-title{display:flex;align-items:center;flex-wrap:wrap;gap:calc(var(--diy-unit, 1px) * 4);font-size:calc(var(--diy-unit, 1px) * 13.5);font-weight:600;overflow-wrap:anywhere}.member-tag{padding:calc(var(--diy-unit, 1px) * 0.5) calc(var(--diy-unit, 1px) * 3);border:calc(var(--diy-unit, 1px) * 0.5) solid var(--member-line);border-radius:calc(var(--diy-unit, 1px) * 2);color:var(--member-accent);font-size:calc(var(--diy-unit, 1px) * 8.5);font-weight:400}.member-description{margin-top:calc(var(--diy-unit, 1px) * 3);color:var(--member-muted);font-size:calc(var(--diy-unit, 1px) * 10);line-height:1.6;overflow-wrap:anywhere}.member-card .member-action{display:flex;align-items:center;gap:calc(var(--diy-unit, 1px) * 2);flex-shrink:0;margin:0;padding:calc(var(--diy-unit, 1px) * 6) 0;border:0;background:transparent;color:var(--member-accent);font:inherit;font-size:calc(var(--diy-unit, 1px) * 11);line-height:1.5;white-space:nowrap}.member-action::after{border:0}.member-action:focus-visible{outline:calc(var(--diy-unit, 1px) * 1) solid var(--member-accent,var(--client-primary,#3479f6));outline-offset:calc(var(--diy-unit, 1px) * 2)}.member-chevron{display:inline-flex;width:calc(var(--diy-unit, 1px) * 14);height:calc(var(--diy-unit, 1px) * 14);align-items:center;justify-content:center}.member-chevron:after{content:'';width:calc(var(--diy-unit, 1px) * 4);height:calc(var(--diy-unit, 1px) * 4);border-top:calc(var(--diy-unit, 1px) * 1) solid var(--member-muted);border-right:calc(var(--diy-unit, 1px) * 1) solid var(--member-muted);transform:rotate(45deg)}.gold.member-card{gap:calc(var(--diy-unit,1px)*8);padding:calc(var(--diy-unit,1px)*10);min-height:calc(var(--diy-unit,1px)*58)}.gold .member-emblem{background:transparent;width:calc(var(--diy-unit,1px)*36);height:calc(var(--diy-unit,1px)*37)}.gold .member-emblem img{width:100%;height:100%}.gold .member-title{font-size:calc(var(--diy-unit,1px)*12.5)}.gold .member-description{margin-top:calc(var(--diy-unit,1px)*1.5);font-size:calc(var(--diy-unit,1px)*10);line-height:1.5}.gold .member-action{padding:calc(var(--diy-unit,1px)*6) calc(var(--diy-unit,1px)*9);border-radius:calc(var(--diy-unit,1px)*20);background:var(--member-accent);color:white}.gold .member-chevron{display:none}.member-card.is-merged{min-height:calc(var(--diy-unit,1px) * 60);padding:calc(var(--diy-unit,1px) * 14) calc(var(--diy-unit,1px) * 16);gap:calc(var(--diy-unit,1px) * 10)}.is-merged .member-emblem{width:calc(var(--diy-unit,1px) * 30);height:calc(var(--diy-unit,1px) * 30);border-radius:calc(var(--diy-unit,1px) * 8)}.is-merged .member-emblem img{width:calc(var(--diy-unit,1px) * 20);height:calc(var(--diy-unit,1px) * 20)}.is-merged .member-title{font-size:calc(var(--diy-unit,1px) * 17);gap:calc(var(--diy-unit,1px) * 6)}.is-merged .member-tag{font-size:calc(var(--diy-unit,1px) * 11);line-height:1.5;padding:calc(var(--diy-unit,1px) * 2) calc(var(--diy-unit,1px) * 6);border:0;border-radius:calc(var(--diy-unit,1px) * 5);background:var(--member-soft)}.member-card.is-merged .member-action{font-size:calc(var(--diy-unit,1px) * 13);font-weight:500;gap:calc(var(--diy-unit,1px) * 4);padding:calc(var(--diy-unit,1px) * 6) 0;background:transparent;color:var(--member-accent)}.member-link-arrow{display:block;width:calc(var(--diy-unit,1px) * 16);height:calc(var(--diy-unit,1px) * 16);object-fit:contain}
</style>

<style scoped>

.account-assets{padding:calc(var(--asset-unit)*16);color:var(--asset-text);box-sizing:border-box;text-align:left}
.asset-heading{margin-bottom:calc(var(--asset-unit)*14)}
.asset-heading-title{display:block;font-size:calc(var(--asset-unit)*15);font-weight:650;line-height:1.5;overflow-wrap:anywhere}
.asset-heading-description{display:block;margin-top:calc(var(--asset-unit)*4);font-size:var(--asset-label-size);color:var(--asset-muted);line-height:1.6;overflow-wrap:anywhere}
.asset-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--asset-gap)}
.account-assets .asset-entry{display:flex;flex-direction:column;align-items:stretch;gap:calc(var(--asset-unit)*10);min-width:0;min-height:calc(var(--asset-unit)*96);margin:0;padding:calc(var(--asset-unit)*14);box-sizing:border-box;border:1px solid var(--asset-border);border-radius:var(--asset-radius);background:var(--asset-surface);color:var(--asset-text);font:inherit;line-height:1.5;text-align:left;cursor:pointer}
.asset-entry::after{border:0}.asset-entry:active{opacity:.8}.asset-entry:focus-visible{outline:2px solid var(--asset-accent);outline-offset:2px}
.asset-top{display:flex;align-items:center;gap:calc(var(--asset-unit)*7);min-width:0}
.asset-icon-wrap{display:flex;align-items:center;justify-content:center;width:calc(var(--asset-unit)*28);height:calc(var(--asset-unit)*28);flex-shrink:0;border-radius:calc(var(--asset-unit)*9);background:var(--asset-soft)}
.asset-icon{display:block;width:calc(var(--asset-unit)*17);height:calc(var(--asset-unit)*17);object-fit:contain}
.asset-label{flex:1;min-width:0;font-size:var(--asset-label-size);font-weight:500;color:var(--asset-muted);overflow-wrap:anywhere}
.asset-chevron{width:calc(var(--asset-unit)*5);height:calc(var(--asset-unit)*5);flex-shrink:0;border-top:1px solid var(--asset-accent);border-right:1px solid var(--asset-accent);transform:rotate(45deg);opacity:.7;margin-right:calc(var(--asset-unit)*2)}
.asset-amount{min-width:0;margin-top:calc(var(--asset-unit)*1)}
.asset-value{display:block;font-size:var(--asset-value-size);font-weight:700;font-variant-numeric:tabular-nums;line-height:1.25;letter-spacing:-.4px;overflow-wrap:anywhere;color:var(--asset-text)}
.asset-recharge{display:inline-flex;align-items:center;justify-content:center;align-self:flex-start;width:100%;min-height:calc(var(--asset-unit)*32);box-sizing:border-box;padding:calc(var(--asset-unit)*6) calc(var(--asset-unit)*12);border:1px solid var(--asset-border);border-radius:calc(var(--asset-unit)*8);background:transparent;color:var(--asset-accent);font-size:calc(var(--asset-unit)*12);font-weight:600;line-height:1.5;white-space:nowrap}.asset-recharge.is-primary{border-color:var(--asset-accent);background:var(--asset-accent);color:#fff}.asset-layout-list .asset-recharge{width:auto;grid-column:2;justify-self:end;margin-top:calc(var(--asset-unit)*6)}
.one-asset .asset-grid,.asset-layout-list .asset-grid{grid-template-columns:minmax(0,1fr)}
.asset-layout-list .asset-entry{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:calc(var(--asset-unit)*16);row-gap:0;min-height:calc(var(--asset-unit)*78)}
.asset-layout-list .asset-top{grid-column:1}.asset-layout-list .asset-amount{grid-column:2;grid-row:1;align-self:center;text-align:right;max-width:calc(var(--asset-unit)*175)}.asset-layout-list .asset-chevron{display:none}
.account-assets.asset-layout-strip{padding:calc(var(--asset-unit)*20) calc(var(--asset-unit)*22)}
.asset-layout-strip .asset-grid{gap:calc(var(--asset-unit)*44)}
.account-assets.asset-layout-strip .asset-entry{align-items:flex-start;gap:calc(var(--asset-unit)*8);padding:0;min-height:0;border:0;border-radius:0;background:transparent;text-align:left}
.asset-layout-strip .asset-top{justify-content:flex-start}.asset-layout-strip .asset-icon-wrap{width:calc(var(--asset-unit)*18);height:calc(var(--asset-unit)*18);background:transparent;border-radius:0}.asset-layout-strip .asset-label{flex:none}.asset-layout-strip .asset-chevron{display:none}
.asset-layout-strip .asset-amount{align-self:stretch;margin-top:0}
.account-assets.asset-layout-strip .asset-recharge{width:auto;min-height:calc(var(--asset-unit)*28);justify-content:flex-start;align-self:flex-start;gap:calc(var(--asset-unit)*4);padding:0;border:0;border-radius:0;background:transparent;color:var(--asset-accent);font-size:calc(var(--asset-unit)*13);font-weight:500}
.asset-recharge-arrow{display:block;flex-shrink:0;width:calc(var(--asset-unit)*14);height:calc(var(--asset-unit)*14);object-fit:contain}
</style>
