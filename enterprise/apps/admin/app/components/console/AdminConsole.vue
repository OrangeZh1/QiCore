<script setup lang="ts">
import {consolePageKey} from '../../utils/console-page'
const props=withDefaults(defineProps<{refreshing?:boolean}>(),{refreshing:false})
const emit=defineEmits<{refresh:[]}>()
const context=inject(consolePageKey),owner=Symbol('console-page')
function register(){if(context){context.owner=owner;context.refresh=()=>emit('refresh');context.refreshing=props.refreshing}}
function release(){if(context?.owner===owner){context.owner=null;context.refresh=null;context.refreshing=false}}
onMounted(register);onActivated(register);onDeactivated(release);onBeforeUnmount(release)
watch(()=>props.refreshing,value=>{if(context?.owner===owner)context.refreshing=value})
</script>
<template><div class="console-page-content"><slot/></div></template>
