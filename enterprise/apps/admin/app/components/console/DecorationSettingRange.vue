<script setup lang="ts">
const props=withDefaults(defineProps<{label:string;min?:number;max?:number;step?:number;unit?:string;disabled?:boolean}>(),{min:0,max:100,step:1,unit:'px'})
const value=defineModel<number>({required:true})
function input(event:Event){const next=Number((event.target as HTMLInputElement).value);if(Number.isFinite(next)&&next>=props.min&&next<=props.max)value.value=next}
function update(event:Event){const next=Number((event.target as HTMLInputElement).value);if(Number.isFinite(next))value.value=Math.max(props.min,Math.min(props.max,next))}
</script>
<template><label class="setting-range"><span>{{label}}</span><div><input type="range" :value="value" :min="min" :max="max" :step="step" :disabled="disabled" @input="update"><span class="setting-number"><input type="number" :value="value" :min="min" :max="max" :step="step" :disabled="disabled" :aria-label="label" @input="input" @change="update"><small>{{unit}}</small></span></div></label></template>
<style scoped>.setting-range{display:grid;gap:10px;font-size:12px;color:var(--ui-text)}.setting-range>div{display:flex;align-items:center;gap:14px}.setting-range input[type=range]{flex:1;min-width:0;accent-color:var(--ui-primary)}.setting-number{display:flex;align-items:center;width:90px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-bg);overflow:hidden}.setting-number input{min-width:0;width:60px;padding:7px 6px;background:transparent;outline:none;font-size:12px}.setting-number small{font-size:10px;color:var(--ui-text-muted);padding-right:6px}</style>
