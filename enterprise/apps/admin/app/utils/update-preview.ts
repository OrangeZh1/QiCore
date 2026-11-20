import type {UpdateTask} from './update-center'
export const previewScenes=[{label:'暂无更新',value:'current'},{label:'发现新版本',value:'available'},{label:'多个应用分页',value:'many_apps'},{label:'更新进行中',value:'running'},{label:'更新成功',value:'succeeded'},{label:'多条更新日志',value:'history'},{label:'更新失败并回滚',value:'rolled_back'},{label:'迁移失败待恢复',value:'recovery_required'},{label:'新版本生效待收尾',value:'closeout'},{label:'预检未通过',value:'blocked'}]
// Development-only presentation data. The caller skips API reads, checks and writes in this mode.
export function updatePreview(scene='available',step='AUTHORIZE'){
  const installed=scene==='succeeded'||scene==='closeout'||scene==='history'
  const now='2026-10-08T10:00:00.000Z',notes='新增：框架更新流程与执行进度展示\n优化：后台布局与页面间距\n修复：重复提交框架更新请求'
  const history=scene==='succeeded'?[{version:'0.2.0',releaseNotes:notes,installedAt:now}]:scene==='history'?[
    {version:'0.2.0',installedAt:now,releaseNotes:notes+'\n修复：关闭图片预览后操作按钮保持隐藏\n优化：素材选择器布局与分页展示\n新增：统一图片、视频和文件管理入口\n安全：上传前校验登录身份与操作权限'},
    {version:'0.1.3',installedAt:'2026-10-06T13:19:43.000Z',releaseNotes:'修复：更新中断后显示明确的恢复状态\n优化：区分健康检查与清理收尾步骤'},
    {version:'0.1.0',installedAt:'2026-10-01T07:35:03.000Z',releaseNotes:'新增：平台工作台与租户管理\n新增：网站品牌和存储设置\n优化：统一后台页面标题和说明'}
  ]:[]
  const task:UpdateTask={id:'preview-update-only',status:scene==='closeout'?'recovery_required':scene,step:scene==='running'?step:scene==='succeeded'?'COMPLETE':scene==='rolled_back'?'HEALTH':scene==='blocked'?'COMPATIBILITY':scene==='closeout'?'CLEANUP':'MIGRATE',version:'0.2.0',fromVersion:'0.1.0',updatedAt:now,...(scene==='rolled_back'?{code:'HEALTH_CHECK_FAILED'}:scene==='recovery_required'?{code:'MIGRATION_RECOVERY_REQUIRED'}:scene==='closeout'?{code:'ACTIVE_HEALTHY_CLOSEOUT_BLOCKED'}:scene==='blocked'?{code:'MIGRATION_CHECKSUM_INVALID'}:{})}
  const applicationLicense={state:'active',allowed:true,label:'授权正常（示例）',expiresAt:null,expiryKnown:true,updatesExpiresAt:'2027-10-08T10:00:00.000Z',updatesEligible:true,tenantLimit:5,tenantLimitKnown:true,tenantUsed:2,tenantUsageKnown:true,tenantRemaining:3}
  const applicationUpdate={state:'not_configured',label:'应用更新待接通',description:'该应用的独立版本检查尚未接通。',currentVersion:null,latestVersion:null,checkedAt:null,canCheck:false}
  const result={productName:'QiCore · 开发预览',allowed:true,canCheck:true,
    applications:{installed:[{packageKey:'app_preview_sample_installed',key:'sample-app',name:'示例业务应用',description:'仅用于开发预览的通用业务应用',source:'bundled',version:null,update:applicationUpdate,license:applicationLicense,management:{available:false,reason:'当前应用随框架内置，独立更新、修复和卸载尚未开放。'}}],
      purchased:[{packageKey:'app_preview_sample',key:null,name:'示例业务应用',description:'仅用于验证已购买未安装的展示状态',source:'catalog',version:null,update:applicationUpdate,license:{...applicationLicense,tenantUsed:0,tenantRemaining:5},management:{available:false,reason:'应用安装服务尚未接通，暂不能下载安装。'}}],catalog:{state:'verified',checkedAt:now,description:''}},
    license:{state:'active',label:'授权正常（示例）',description:'模拟状态',companyName:'演示公司',domain:'preview.example.com',expiresAt:null,expiryKnown:true,updatesExpiresAt:'2027-10-08T10:00:00.000Z',verified:false,checkedAt:now,lastCheckFailed:false},
    update:{state:installed?'current':'available',label:installed?'当前版本已生效（示例）':'发现新版本（示例）',description:'模拟框架更新，不改变应用版本。',currentVersion:installed?'0.2.0':'0.1.0',latestVersion:installed?null:'0.2.0',checkedAt:now,releaseNotes:notes,mandatory:false,miniProgramUpdateRequired:false},
    automatic:{authorizationIntervalSeconds:300,updateIntervalSeconds:21600},installer:{available:true,canInstall:scene==='available',reason:'当前为模拟演示，不执行真实更新'},
    tasks:['current','available','history','many_apps'].includes(scene)?[]:[task],history:{available:true,items:history,total:history.length,description:''}}
  if(scene==='current')result.update={...result.update,state:'current',label:'暂无可用更新',description:'已检查，目前没有更高的可用版本。',latestVersion:null}
  if(scene==='many_apps'){
    const sample=result.applications.installed[0]!
    result.applications.installed=Array.from({length:26},(_,index)=>({...sample,key:'preview-'+index,packageKey:'app_preview_'+index,name:index===0?'示例业务应用 · 多门店服务与预约管理':'示例应用 '+String(index+1).padStart(2,'0')}))
    result.applications.purchased=Array.from({length:8},(_,index)=>({...result.applications.purchased[0]!,packageKey:'app_bought_'+index,name:'待安装示例 '+String(index+1).padStart(2,'0')}))
  }
  return result
}
