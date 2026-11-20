<script setup lang="ts">
import type {createDiscardChanges} from '../../composables/useDiscardChanges'
import ConsoleFormActions from '@orangezh1/qisvc-console-ui/components/ConsoleFormActions'
defineProps<{controller:ReturnType<typeof createDiscardChanges>}>()
</script>
<template><UModal :open="controller.open.value" title="放弃未保存的修改？" description="继续后，本次未保存的修改将丢失，已保存的内容不受影响。" :dismissible="!controller.blocked.value" @update:open="!$event&&controller.keep()"><template #footer><ConsoleFormActions><UButton color="neutral" variant="outline" :disabled="controller.blocked.value" @click="controller.keep">继续编辑</UButton><UButton :disabled="controller.blocked.value" @click="controller.confirm">放弃修改</UButton></ConsoleFormActions></template></UModal></template>
