<script setup lang="ts">
import ConsoleFrame from './ConsoleFrame.vue'
import ConsoleSidebarLink from '@orangezh1/qisvc-console-ui/components/ConsoleSidebarLink'
import AreaSidebarGroup from './AreaSidebarGroup.vue'
import {platformLanding,consoleBreadcrumbs,filterConsoleItems,markConsoleItems,normalizeConsolePath,type ConsoleMenuGroup} from '../../utils/console-navigation'
import {platformConsole} from '../../config/console'
defineProps<{refreshing?:boolean}>()
const emit=defineEmits<{refresh:[]}>()
const {path:displayPath}=useConsoleNavigation(),auth=useApi()
const mapGroups=(groups:readonly ConsoleMenuGroup[])=>groups.map(group=>({...group,items:markConsoleItems(filterConsoleItems(group.items,auth.session.value),displayPath.value)})).filter(group=>group.items.length)
const menuLinks=computed(()=>filterConsoleItems(platformConsole.links,auth.session.value))
const menuGroups=computed(()=>mapGroups(platformConsole.groups))
const breadcrumbs=computed(()=>{
  if(normalizeConsolePath(displayPath.value)===platformConsole.home)return[{label:'工作台'}]
  const nested=consoleBreadcrumbs(menuGroups.value,displayPath.value)
  return[{label:auth.session.value?.permissions.includes('overview.read')?'工作台':'平台',to:auth.session.value?.permissions.includes('overview.read')?platformConsole.home:undefined},...(nested.length?nested:[{label:displayPath.value==='/admin/updates'?'框架与应用':'个人资料'}])]
})
const {openGroups,toggleGroup}=useConsoleMenuExpansion('admin',menuGroups)
function refreshPage(){emit('refresh')}
</script>
<template>
  <ConsoleFrame portal="admin" :brand-to="platformLanding(auth.session.value!)" :breadcrumbs="breadcrumbs" :refreshing="refreshing" profile-to="/admin/profile" :fill="displayPath==='/admin/materials'" @refresh="refreshPage">
    <template #navigation="{collapsed}"><template v-for="item in menuLinks"><ConsoleSidebarLink v-if="'to' in item" :key="item.to" :label="item.label" :icon="item.icon" :to="item.to" :active="normalizeConsolePath(displayPath)===item.to" :collapsed="collapsed"/></template><template v-for="group in menuGroups" :key="group.key"><ConsoleSidebarLink v-if="group.to" :label="group.label" :icon="group.icon" :to="group.to" :active="normalizeConsolePath(displayPath)===group.to" :collapsed="collapsed"/><AreaSidebarGroup v-else :group-key="group.key" :label="group.label" :icon="group.icon" :items="group.items" :open-groups="openGroups" :collapsed="collapsed" @toggle="toggleGroup"/></template></template>
    <slot/>
  </ConsoleFrame>
</template>
