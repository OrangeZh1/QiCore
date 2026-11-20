<script setup lang="ts">
import ConsoleDiscardChangesDialog from '~/components/console/ConsoleDiscardChangesDialog.vue'
const discard=useDiscardChanges(()=>busy.value||reading.value)
const busyAction=ref<'refresh'|'save'>('refresh')
import AccountImageInput from '../../components/console/AccountImageInput.vue'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
import ConsoleFormActions from '@orangezh1/qisvc-console-ui/components/ConsoleFormActions'
import ConsoleProfileLayout from '@orangezh1/qisvc-console-ui/components/ConsoleProfileLayout'
import AdminConsole from '../../components/console/AdminConsole.vue'
definePageMeta({layout:'admin'})
const {site}=useSiteBranding()
const auth=useApi(),toast=useToast(),nickname=ref(''),avatar=ref<string|null>(null),version=ref(0),busy=ref(false),reading=ref(false),error=ref('')
const session=await auth.restore()
if(!session)await navigateTo('/admin/login',{replace:true})
else if(session.role!=='root')throw createError({statusCode:403,statusMessage:'需要平台管理员身份'})
function fill(){if(!auth.session.value)return;nickname.value=auth.session.value.nickname;avatar.value=auth.session.value.avatar;version.value=auth.session.value.profileVersion}
fill()
const dirty=computed(()=>nickname.value!==auth.session.value?.nickname||avatar.value!==auth.session.value?.avatar)
async function refresh(){if(busy.value||reading.value)return;if(dirty.value){discard.request(()=>{fill();error.value='';void refresh()});return}busyAction.value='refresh';busy.value=true;try{const s=await auth.restore();if(!s){await navigateTo('/admin/login');return}fill();error.value=''}finally{busy.value=false}}

async function save(){
  if(busy.value||reading.value)return
  if(!nickname.value.trim()||nickname.value.trim().length>32){error.value='昵称须为 1–32 个字符';return}
  busyAction.value='save';busy.value=true;error.value=''
  try{const updated=await auth.api<Pick<AdminSession,'nickname'|'avatar'|'profileVersion'>>('/admin/auth/profile','PUT',{nickname:nickname.value.trim(),avatar:avatar.value,version:version.value});if(auth.session.value)Object.assign(auth.session.value,updated);fill();toast.add({title:'个人资料已保存',color:'success'})}
  catch(e){error.value=e instanceof Error?e.message:'保存失败，请重试'}finally{busy.value=false}
}
onBeforeRouteLeave(to=>{if(!auth.session.value)return;if(busy.value||reading.value){toast.add({title:'正在处理，请稍候再离开',color:'neutral'});return false}if(dirty.value){discard.request(()=>{fill();void navigateTo(to.fullPath)});return false}})
</script>
<template>
  <AdminConsole :refreshing="busy&&busyAction==='refresh'" @refresh="refresh">
    <ConsoleProfileLayout description="管理当前账号的头像和显示昵称。">
      <form class="space-y-6" @submit.prevent="save">
        <AccountImageInput v-model="avatar" label="头像" purpose="profile" :fallback="site?.platform.defaultAvatar||'/brand/admin-avatar.png'" :disabled="busy" @busy="reading=$event"/>
        <UFormField label="登录账号"><ConsoleInput :model-value="auth.session.value?.username||''" disabled/></UFormField>
        <UFormField label="昵称" required><ConsoleInput v-model="nickname" :maxlength="32" :disabled="busy" placeholder="请输入昵称"/></UFormField>
        <UAlert v-if="error" color="error" :title="error"/>
        <ConsoleFormActions><UButton color="neutral" variant="outline" :disabled="busy||reading||!dirty" @click="discard.request(()=>{fill();error=''})">取消修改</UButton><UButton type="submit" :loading="busy&&busyAction==='save'" :disabled="busy||reading||!version||!dirty">保存资料</UButton></ConsoleFormActions>
      </form>
      <template #aside><dl class="space-y-5 text-sm"><div><dt class="text-muted">账号角色</dt><dd class="mt-2">{{auth.session.value?.roleName}}</dd></div><div><dt class="text-muted">管理范围</dt><dd class="mt-2">平台管理</dd></div></dl><p class="text-xs leading-6 text-muted">头像与昵称用于后台展示。账号、角色及数据权限由服务端管理，无法在此修改。</p></template>
    </ConsoleProfileLayout>
  <ConsoleDiscardChangesDialog :controller="discard"/></AdminConsole>
</template>
