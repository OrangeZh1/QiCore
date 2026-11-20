<script setup lang="ts">
import ConsoleFormActions from '@orangezh1/qisvc-console-ui/components/ConsoleFormActions'
withDefaults(defineProps<{dirty:boolean;busy:boolean;saving:boolean;canWrite:boolean;saveDisabled?:boolean;saveAvailable?:boolean;hint?:string}>(),{saveDisabled:false,saveAvailable:false,hint:''})
defineEmits<{cancel:[]}>()
</script>
<template><div class="console-settings-actions sticky bottom-0 z-10 border-t border-default bg-default/95 px-5 py-4 backdrop-blur sm:px-7"><ConsoleFormActions><span v-if="hint||dirty" class="mr-auto text-xs text-muted">{{hint||'有未保存的修改'}}</span><slot name="before"/><UButton type="button" color="neutral" variant="outline" :disabled="busy||!dirty" @click="$emit('cancel')">取消修改</UButton><UButton v-if="canWrite" type="submit" :loading="saving" :disabled="busy||(!dirty&&!saveAvailable)||saveDisabled">保存设置</UButton></ConsoleFormActions></div></template>
