<script setup lang="ts">
import ConsoleShell from '../console-ui/ConsoleShell.vue'
import AreaSidebarGroup from '../console-ui/AreaSidebarGroup.vue'
import {activeTrail,canonicalMenuPath,visibleMenu,type CoreMenuGroup} from '../utils/console-navigation'
import ConsoleSidebarLink from '../console-ui/ConsoleSidebarLink.vue'
import ConsoleTopbar from '../console-ui/ConsoleTopbar.vue'
import ConsoleUserMenu from '../console-ui/ConsoleUserMenu.vue'
import ConsolePageHeading from '../console-ui/ConsolePageHeading.vue'
import ConsoleThemeToggle from '../console-ui/ConsoleThemeToggle.vue'

type Menu = { path: string; title: string; icon?: string }


const props = defineProps<{ title: string; fill?: boolean; refreshPage?: () => Promise<unknown> }>()
const config = useAppConfig().qicore
const home = config.workbenchPath || '/'
const route = useRoute()
const router = useRouter()
const displayPath = computed(() => import.meta.server ? route.path : router.currentRoute.value.path)
const { data: me, error } = await useCoreSession()
if (error.value?.statusCode === 401) await navigateTo('/login')
useHead(() => ({ title: props.title + ' · ' + (me.value?.brand || 'QiCore') }))

const inRoute = (path: string) => displayPath.value === path || (path !== home && displayPath.value.startsWith(path+'/'))
const links = computed<Menu[]>(() => [
  { path: home, title: '工作台', icon: 'lucide:layout-dashboard' },
  ...(coreCan(me.value, 'core.materials.read') ? [{ path:'/admin/materials',title:'素材管理',icon:'lucide:images' }] : []),
  ...(me.value?.menus || []),
])
const definition:CoreMenuGroup[] = [
  {key:'permissions',label:'权限管理',icon:'i-lucide-shield-check',items:[
    {to:'/admin/accounts',label:'管理员',icon:'i-lucide-users',permission:'core.accounts.read'},
    {to:'/admin/roles',label:'角色',icon:'i-lucide-shield-check',permission:'core.roles.read'},
  ]},
  {key:'settings',label:'系统设置',icon:'i-lucide-settings',items:[
    {to:'/admin/site',label:'站点设置',icon:'i-lucide-settings',permission:'core.site.read'},
    {to:'/admin/storage',label:'存储设置',icon:'i-lucide-database',permission:'core.storage.read'},
    {key:'login-registration',label:'登录注册',icon:'i-lucide-log-in',children:[
      {to:'/admin/policies',label:'协议管理',icon:'i-lucide-file-text',permission:'core.content.read'},
    ]},
  ]},
  {key:'content',label:'内容管理',icon:'i-lucide-headphones',items:[
    {to:'/admin/help',label:'帮助中心',icon:'i-lucide-circle-help',permission:'core.content.read'},
    {to:'/admin/customer-service',label:'客服设置',icon:'i-lucide-headphones',permission:'core.content.read'},
  ]},
]
const order=['content','permissions','settings']
const groups = computed(()=>definition.map(group=>({...group,items:visibleMenu(group.items,displayPath.value,p=>coreCan(me.value,p))})).filter(group=>group.items.length).sort((a,b)=>order.indexOf(a.key)-order.indexOf(b.key)))
const trail = computed(()=>{
  for(const group of groups.value){
    const nested=activeTrail(group.items)
    if(nested.length)return [{label:group.label,key:group.key,to:undefined as string|undefined},...nested]
  }
  return []
})
const opened = useState<string[]>('core-navigation-groups',()=>[])
watch(()=>[displayPath.value,me.value?.account.id],()=>{
  for(const item of trail.value) if(item.key && !opened.value.includes(item.key))opened.value=[...opened.value,item.key]
},{immediate:true})
function toggleGroup(key:string){opened.value=opened.value.includes(key)?opened.value.filter(id=>id!==key):[...opened.value,key]}
const crumbs = computed(()=>displayPath.value===home ? [{label:'工作台'}] : [
  {label:'工作台',to:home},...trail.value.filter(item=>item.key || canonicalMenuPath(displayPath.value)!==displayPath.value).map(item=>({label:item.label,to:item.to})),{label:props.title},
])
const refreshing = ref(false)
const refreshError = ref('')
async function refreshPage() {
  if (refreshing.value) return
  refreshing.value = true
  refreshError.value = ''
  try {
    if (props.refreshPage) await props.refreshPage()
    else await refreshNuxtData()
  } catch {
    refreshError.value = '刷新失败，请重试'
  } finally {
    refreshing.value = false
  }
}

const leaving = ref(false)
const logoutError = ref('')
async function logout() {
  if (leaving.value) return
  leaving.value = true
  logoutError.value = ''
  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
    clearNuxtData()
    await navigateTo('/login')
  } catch {
    logoutError.value = '退出失败，请重试'
  } finally {
    leaving.value = false
  }
}
</script>
<template>
  <ConsoleShell
    managed-sidebar
    :brand-name="me?.brand"
    :brand-caption="config.consoleCaption"
    :brand-logo-src="me?.site?.logo || config.brandMark"
    :brand-to="home"
    :show-sidebar-theme="false"
    :sidebar="{ id: 'navigation', menu: { title: '主导航', description: '选择要打开的页面' }, ui: { footer: 'hidden' } }"
    :storage-key="'core-console-' + encodeURIComponent(me?.brand || 'QiCore')"
    :class="{ 'core-frame-fill': fill }"
    :stage-class="'w-full px-5 py-4 sm:px-8 sm:py-12 lg:px-14 lg:pb-14 lg:pt-16' + (fill ? ' flex min-h-0 flex-1 flex-col' : '')"
  >
    <template #navigation="{ collapsed }">
      <ConsoleSidebarLink
        v-for="item in links" :key="item.path" :to="item.path" :label="item.title"
        :icon="item.icon || 'lucide:file'" :collapsed="collapsed"
        :active="inRoute(item.path)"
      />
      <AreaSidebarGroup v-for="group in groups" :key="group.key" :group-key="group.key" :label="group.label" :icon="group.icon"
        :items="group.items" :collapsed="collapsed" :open-groups="opened" @toggle="toggleGroup" />
    </template>
    <template #header>
      <ConsoleTopbar :breadcrumbs="crumbs" :refreshing="refreshing" @refresh="refreshPage">
        <template #actions>
          <ConsoleThemeToggle />
          <ConsoleUserMenu
            :name="me?.account.displayName" :avatar-url="me?.account.avatar" :avatar-fallback-src="me?.site?.defaultAvatar || '/brand/admin-avatar.png'"
            :disabled="leaving" :aria-busy="leaving"
            :items="[{ label: '个人资料', icon: 'i-lucide-user-round', to: '/admin/profile' }, { label: '退出登录', icon: 'i-lucide-log-out', onSelect: logout }]"
          >
            <template v-if="leaving" #avatar>
              <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" aria-label="正在退出" />
            </template>
          </ConsoleUserMenu>
        </template>
      </ConsoleTopbar>
    </template>
    <ConsolePageHeading :title="title"><template v-if="$slots.actions" #actions><slot name="actions" /></template></ConsolePageHeading>
    <p v-if="refreshError || logoutError" role="alert">{{ refreshError || logoutError }}</p>
    <slot :session="me" />
    <footer v-if="me?.site && (me.site.copyright || me.site.filing.icpNumber || me.site.filing.policeNumber)" class="mt-8 flex flex-wrap justify-center gap-3 text-xs text-muted">
      <span v-if="me.site.copyright">{{ me.site.copyright }}</span>
      <component v-for="record in [{text:me.site.filing.icpNumber,href:me.site.filing.icpLink},{text:me.site.filing.policeNumber,href:me.site.filing.policeLink}].filter(r=>r.text)"
        :key="record.text" :is="record.href?'a':'span'" :href="record.href || undefined" :target="record.href?'_blank':undefined" rel="noopener noreferrer">{{ record.text }}</component>
    </footer>
  </ConsoleShell>
</template>
