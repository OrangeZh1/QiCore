<script setup lang="ts">
import ConsoleInput from './ConsoleInput.vue'

defineOptions({ inheritAttrs: false })
withDefaults(defineProps<{ placeholder?: string; maxlength?: number | string }>(), { placeholder: '搜索', maxlength: 100 })
const model = defineModel<string>({ default: '' })
</script>

<template>
  <ConsoleInput v-model="model" v-bind="$attrs" :placeholder="placeholder" :maxlength="maxlength" :aria-label="$attrs['aria-label'] || placeholder" icon="i-lucide-search" size="md" class="w-full sm:w-80" />
</template>
