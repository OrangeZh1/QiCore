<script setup lang="ts">
const emit=defineEmits<{submit:[event:Event];invalid:[message:string]}>()
function submit(event:Event){
 const form=event.currentTarget as HTMLFormElement
 const input=Array.from(form.elements).find((item):item is HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement=>(item instanceof HTMLInputElement||item instanceof HTMLTextAreaElement||item instanceof HTMLSelectElement)&&item.willValidate&&!item.validity.valid)
 if(input){
  const label=input.labels?.[0]?.textContent?.trim()||input.getAttribute('aria-label')||'此项'
  const validity=input.validity
  const message=validity.valueMissing?'请填写'+label:validity.rangeUnderflow||validity.rangeOverflow?label+'须在 '+input.getAttribute('min')+'–'+input.getAttribute('max')+' 之间':validity.stepMismatch?label+'须为整数':validity.typeMismatch?'请输入有效的'+label:label+'格式不正确'
  emit('invalid',message);input.focus();return
 }
 emit('submit',event)
}
</script>
<template><form novalidate @submit.prevent="submit"><slot/></form></template>
