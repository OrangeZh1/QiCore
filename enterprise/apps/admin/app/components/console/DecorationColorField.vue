<script setup lang="ts">
defineProps<{label:string;disabled?:boolean}>()
const value=defineModel<string>({required:true})
</script>
<template><label class="decoration-color-field"><span>{{label}}</span><div><input v-model="value" type="color" :aria-label="label" :disabled="disabled"><input v-model="value" type="text" :aria-label="label+'色值'" maxlength="7" pattern="#[0-9a-fA-F]{6}" :disabled="disabled" spellcheck="false"></div></label></template>
<style scoped>.decoration-color-field{display:grid;gap:8px;font-size:12px;color:var(--ui-text-muted)}.decoration-color-field>div{display:flex;align-items:center;border:1px solid var(--ui-border);border-radius:7px;background:var(--ui-bg);padding:5px;gap:8px}.decoration-color-field input[type=color]{width:26px;height:24px;border:0;padding:0;border-radius:4px;background:transparent;cursor:pointer;flex-shrink:0}.decoration-color-field input[type=text]{min-width:0;width:100%;font-size:12px;color:var(--ui-text);outline:0;background:transparent;font-family:ui-monospace,monospace}.decoration-color-field:has(input:disabled){opacity:.6}</style>
