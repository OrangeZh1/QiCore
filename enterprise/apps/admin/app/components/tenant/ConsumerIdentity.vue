<script setup lang="ts">
import ConsoleAvatar from '@orangezh1/qisvc-console-ui/components/ConsoleAvatar'
defineProps<{userId:string;profile?:{nickname:string|null;avatar:string|null;defaultAvatar?:string|null}|null;prominent?:boolean}>()
const {site}=useSiteBranding()
</script>
<template><div class="flex min-w-0 items-center" :class="prominent?'gap-4':'min-w-36 gap-3'"><ConsoleAvatar :src="profile?.avatar" :fallback-src="profile?.defaultAvatar||site?.tenant.defaultAvatar||'/brand/admin-avatar.png'" :alt="(profile?.nickname||userId)+'的头像'" class="shrink-0" :class="prominent?'size-14':'size-9'"/><div class="min-w-0"><p class="text-highlighted" :class="prominent?'break-all text-lg font-semibold':'max-w-40 truncate text-sm font-medium'" :title="profile?.nickname||userId">{{profile?.nickname||userId}}</p><p v-if="profile?.nickname&&profile.nickname!==userId" class="mt-1 text-xs text-muted" :class="prominent?'break-all':'max-w-40 truncate'" :title="userId">{{prominent?'账号：':''}}{{userId}}</p></div></div></template>
