// Presentation helpers adapted from school-shop.
export type UpdateTask={id:string;operation?:string;status:string;step:string;businessAvailable?:boolean;code?:string;integrity?:{path:string;kind:'modified'|'missing'|'unknown'|'unsafe'}[];version:string|null;fromVersion:string|null;updatedAt:string}
export const updateSteps=['环境检查','下载与校验','备份与迁移','切换与健康检查','清理与完成']
export const operationTitle=(operation?:string)=>(({install:'安装',repair:'修复',uninstall:'卸载'} as Record<string,string>)[operation||'']||'更新')
export function operationSteps(operation?:string){return operation==='uninstall'?['检查影响','暂停与排空','移除运行入口','健康检查','完成卸载']:operation==='repair'?['检查原版本','下载与校验','暂停业务','文件恢复与健康检查','完成修复']:updateSteps}
export function updateStepIndex(step:string,operation?:string){if(operation==='uninstall')return ['AUTHORIZE','INVENTORY'].includes(step)?0:['MAINTENANCE','STOP'].includes(step)?1:step==='SWITCH'?2:['HEALTH','COMMIT'].includes(step)?3:4;return ['AUTHORIZE','INVENTORY','RECOVERY_ARCHIVE'].includes(step)?0:['PULL','COMPATIBILITY'].includes(step)?1:['MAINTENANCE','STOP','BACKUP','MIGRATE'].includes(step)?2:['SWITCH','HEALTH','COMMIT'].includes(step)?3:4}
export function updateNotice(task:UpdateTask){
  if(task.status==='blocked'&&task.code==='SCOPED_UPDATE_DEPENDENCY_CONFLICT')return {title:operationTitle(task.operation)+'未开始',description:'已安装应用与目标版本存在依赖冲突，请先更新相关应用到兼容版本，再检查更新。当前运行版本没有切换。',color:'warning' as const,icon:'i-lucide-circle-alert'}
  if(task.status==='blocked'&&task.code==='APPLICATION_LAYOUT_INCOMPLETE')return {title:operationTitle(task.operation)+'未开始',description:'应用包缺少必需文件，请联系应用提供方补齐完整安装包后重试。当前运行版本没有切换。',color:'warning' as const,icon:'i-lucide-circle-alert'}
  if(task.operation&&task.operation!=='update'){
    const name=operationTitle(task.operation)
    if(task.status==='succeeded')return {title:name+'完成',description:task.operation==='uninstall'?'应用程序已卸载，业务数据、配置和绑定已保留。':task.operation==='repair'?'原版本的程序文件已恢复，健康检查通过，业务数据和配置保留。':'应用已安装并通过健康检查。',color:'success' as const,icon:'i-lucide-circle-check'}
    if(task.status==='running')return {title:'正在'+name,description:`正在进行${operationSteps(task.operation)[updateStepIndex(task.step,task.operation)]}，请勿关闭服务器。`,color:'primary' as const,icon:'i-lucide-refresh-cw'}
    if(task.code==='ACTIVE_HEALTHY_CLOSEOUT_BLOCKED')return {title:name+'已生效，等待完成收尾',description:task.businessAvailable?'业务已恢复，清理或恢复记录仍需处理，可重试收尾。':'业务尚未确认恢复，清理或恢复记录仍需处理，可重试收尾。',color:'warning' as const,icon:'i-lucide-circle-alert'}
    if(task.status==='blocked')return {title:name+'未开始',description:'执行条件未通过，当前运行版本没有切换。请查看任务原因后重新检查。',color:'warning' as const,icon:'i-lucide-circle-alert'}
    if(task.status==='rolled_back')return {title:name+'失败，已恢复',description:'原有运行版本已恢复并通过健康检查，业务数据保留。',color:'warning' as const,icon:'i-lucide-circle-alert'}
    return {title:name+'需要人工恢复',description:'已停止后续操作并保留恢复记录。请核查失败原因，不要重复执行迁移或清理文件。',color:'error' as const,icon:'i-lucide-circle-alert'}
  }
  if(task.status==='succeeded')return {title:'更新完成',description:'新版本已通过健康检查，系统已恢复正常使用。',color:'success' as const,icon:'i-lucide-circle-check'}
  if(task.status==='running')return {title:'正在更新',description:`正在进行${updateSteps[updateStepIndex(task.step)]}，请勿关闭服务器。`,color:'primary' as const,icon:'i-lucide-refresh-cw'}
  if(task.code==='ACTIVE_HEALTHY_CLOSEOUT_BLOCKED')return {title:'新版本已生效，等待完成收尾',description:task.businessAvailable?'业务已恢复，旧程序清理或恢复引用尚未处理完成，可重试收尾。':'业务尚未确认恢复，旧程序清理或恢复引用尚未处理完成，可重试收尾。',color:'warning' as const,icon:'i-lucide-circle-alert'}
  if(task.status==='rolled_back')return {title:'更新失败，已回滚',description:`新版本未通过检查，已恢复至 v${task.fromVersion}。请处理失败原因后再尝试更新。`,color:'warning' as const,icon:'i-lucide-circle-alert'}
  if(task.status==='blocked')return {title:'更新未开始',description:'环境检查或版本校验未通过，当前业务版本没有切换。',color:'warning' as const,icon:'i-lucide-circle-alert'}
  return {title:'更新需要人工恢复',description:task.code==='MIGRATION_RECOVERY_REQUIRED'?'数据库迁移未完成，已停止后续操作。请联系运维检查恢复记录，勿重复更新。':'恢复流程尚未完成，请联系运维检查恢复记录。',color:'error' as const,icon:'i-lucide-circle-alert'}
}
export function releaseNoteLines(notes:string){
  if(!notes)return [];
  return notes.split(/\r?\n/).filter(line=>!/^(?:小程序更新[：:]\s*(?:需要客户自行上传|无需更新)|强制更新[：:]\s*[是否])\s*$/.test(line.trim()))
    .map(line=>{const text=line.trim(),heading=/^【(.+)】$/.exec(text)??/^#{1,6}\s+(.+)$/.exec(text);if(heading)return {tag:'',text:heading[1]!,heading:true};const match=/^(?:[-*]\s+)?(?:\[)?(新增|修复|优化|调整|安全)(?:\])?[：:、\s-]+(.*)$/.exec(text);return match?{tag:match[1]!,text:match[2]!}:{tag:'',text:line}})
}
export function releasePresentation<T extends {releaseNotes:string;miniProgramUpdateRequired?:boolean}>(release:T,component:'framework'|'application'){
 const marker=/^\s*小程序更新[：:]\s*(需要客户自行上传|无需更新)\s*$/m.exec(release.releaseNotes);
 return {...release,miniProgramUpdateRequired:component==='framework'?false:release.miniProgramUpdateRequired??(marker?marker[1]==='需要客户自行上传':undefined)};
}
export function dateTime(value?:string|null){return value?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value)):'—'}
export function expiry(value:string|null|undefined,known:boolean){return !known?'待获取':value?dateTime(value):'长期有效'}

export function applicationTenantQuota(value:{tenantLimit?:number|null;tenantLimitKnown?:boolean;tenantUsed?:number|null;tenantUsageKnown?:boolean}){
 const used=value.tenantUsageKnown&&Number.isSafeInteger(value.tenantUsed)&&value.tenantUsed!>=0?value.tenantUsed!:null;
 const known=value.tenantLimitKnown&&(value.tenantLimit===null||Number.isSafeInteger(value.tenantLimit)&&value.tenantLimit!>=0);
 const total=known?(value.tenantLimit===null?'不限':value.tenantLimit+' 个'):'待获取';
 const remaining=!known?'待获取':value.tenantLimit===null?'不限':used===null?'待获取':Math.max(0,value.tenantLimit!-used)+' 个';
 return{used:used===null?'待获取':used+' 个',total,remaining,summary:'已用 '+(used??'待获取')+' / '+(known?(value.tenantLimit??'不限'):'待获取')};
}
