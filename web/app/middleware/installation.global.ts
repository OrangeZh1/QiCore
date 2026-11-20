export default defineNuxtRouteMiddleware(async to=>{
  if(to.meta.publicLanding===true)return
  if(!['/','/login','/install','/admin'].includes(to.path) && !to.path.startsWith('/admin/'))return
  const installed=useState('qicore-installed',()=>false)
  if(!installed.value){
    const request=useRequestFetch()
    try{
      const state=await request<{installed:boolean}>('/api/install/status')
      installed.value=state.installed
    }catch{return}
  }
  if(!installed.value && to.path!=='/install')return navigateTo('/install',{replace:true})
  if(installed.value && to.path==='/install')return navigateTo('/login',{replace:true})
})
