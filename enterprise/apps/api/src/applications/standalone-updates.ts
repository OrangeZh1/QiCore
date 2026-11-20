import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { fail } from '../core/errors.mjs'
import type { LicenseRuntime } from '../license/runtime.js'
import { standaloneRelease } from './standalone-release-state.mjs'
import { updaterRequest } from '../lifecycle/updater-client.js'

const semver = z.string().regex(/^\d+\.\d+\.\d+$/)
const apply = z.object({requestId:z.uuid(), targetVersion:semver}).strict()
const slot = z.object({slot:z.string(),version:semver,frameworkVersion:semver})
const status = z.object({configured:z.literal(true),current:slot,previous:slot.nullable(),
  job:z.object({id:z.string(),status:z.string(),phase:z.string().optional(),error:z.string().nullable().optional()}).nullable()})
const offer = z.object({available:z.boolean(),version:semver.nullable(),releaseNotes:z.string()})
type Offer = z.infer<typeof offer> & {checkedAt:string;slot:string}

// Use the dedicated full-product helper socket. Its current slot must be the one
// identified by this runtime's verified signed release, including the manifest hash.
export class StandaloneUpdates {
  private checked?:Offer
  private submitted?:{id:string;version:string;jobId?:string}
  constructor(private license:LicenseRuntime,private call=updaterRequest) {}
  private socket() {
    const path=process.env.QICORE_STANDALONE_UPDATER_SOCKET
    if(process.env.NODE_ENV!=='production'||!path||!isAbsolute(path))throw Error('STANDALONE_HELPER_NOT_CONFIGURED')
    return path
  }
  private async active() {
    const path=this.socket(), main=this.license.standalone?.main
    const verified=standaloneRelease()
    if(!main||!verified||verified.productKey!==main.packageKey||this.license.client.product.appKey!==verified.productKey)throw Error('STANDALONE_ACTIVE_RECEIPT_REQUIRED')
    const current=status.parse(await this.call('/status',undefined,path))
    if(current.current.slot!==verified.slot||current.current.version!==verified.version||current.current.frameworkVersion!==verified.frameworkVersion)throw Error('STANDALONE_ACTIVE_RECEIPT_MISMATCH')
    return {path,current}
  }
  async check() {
    const main=this.license.standalone?.main
    if(!main)throw fail('STANDALONE_PRODUCT_REQUIRED','独立框架未接入商业应用',409)
    this.license.assertComponentAllowed(main.packageKey,'app')
    const {path,current}=await this.active()
    const result=offer.parse(await this.call('/check',{},path))
    if(result.available!==!!result.version)throw Error('STANDALONE_HELPER_INVALID_OFFER')
    this.checked={...result,slot:current.current.slot,checkedAt:new Date().toISOString()}
    return this.checked
  }
  async view(applications:unknown) {
    const base=this.license.updateCenter(), main=this.license.standalone?.main
    const unconfigured={...base,packageKey:main?.packageKey??null,applications,tasks:[],
      installer:{available:false,canInstall:false,reason:main?'此环境尚未配置整包更新助手':'纯框架无需商业应用更新'}}
    if(!main||!process.env.QICORE_STANDALONE_UPDATER_SOCKET)return unconfigured
    try {
      const {current}=await this.active(),checked=this.checked?.slot===current.current.slot?this.checked:undefined
      const job=current.job
      const tasks=job?[{id:this.submitted?.jobId===job.id?this.submitted.id:job.id,operation:'update',status:job.status,step:job.phase,code:job.error,packageKey:main.packageKey}]:[]
      const available=!job||!['running','queued','recovery_required'].includes(job.status)
      const eligible=this.license.client.componentStatus(main.packageKey,'app').updatesEligible
      return {...base,packageKey:main.packageKey,applications,tasks,
        update:{...base.update,state:checked?(checked.available?'available':'current'):'not_checked',label:checked?(checked.available?'发现新版本':'当前已是最新版'):'尚未检查',
          description:'框架、主应用和随包插件随产品版本升级',canCheck:eligible,currentVersion:current.current.version,latestVersion:checked?.version??null,releaseNotes:checked?.releaseNotes??'',checkedAt:checked?.checkedAt??null},
        installer:{available:true,canInstall:available&&eligible&&checked?.available===true,reason:available?'':'产品更新或恢复正在进行'}}
    } catch {return {...unconfigured,installer:{available:false,canInstall:false,reason:'整包更新助手或当前版本回执无法核实'}}}
  }
  async execute(body:unknown) {
    const q=apply.safeParse(body),main=this.license.standalone?.main
    if(!q.success||!main)throw fail('WHOLE_PRODUCT_REQUIRED','请选择整个产品的目标版本',409)
    const {requestId,targetVersion}=q.data
    this.license.assertComponentAllowed(main.packageKey,'app')
    if(!this.license.client.componentStatus(main.packageKey,'app').updatesEligible)throw fail('UPDATE_NOT_ELIGIBLE','当前授权不含更新权益',403)
    const {path,current}=await this.active()
    if(this.submitted?.id===requestId){
      if(this.submitted.version!==targetVersion)throw fail('REQUEST_ID_REUSED','操作编号已用于另一目标版本',409)
      if(this.submitted.jobId)return {accepted:true,taskId:requestId}
      throw fail('UPDATE_RESULT_UNKNOWN','请查看整包更新助手状态后再决定是否重试',409)
    }
    if(this.submitted&&!this.submitted.jobId)throw fail('UPDATE_RESULT_UNKNOWN','请核实上一次整包更新的执行结果',409)
    if(this.checked?.slot!==current.current.slot||!this.checked.available||this.checked.version!==targetVersion)throw fail('UPDATE_VERSION_CHANGED','请先检查整包版本',409)
    if(current.job&&['running','queued','recovery_required'].includes(current.job.status))throw fail('UPDATE_ALREADY_ACTIVE','已有产品更新或恢复任务',409)
    this.submitted={id:requestId,version:targetVersion}
    try{
      const job=z.object({id:z.string().min(1),status:z.string()}).parse(await this.call('/apply',{version:targetVersion},path))
      this.submitted.jobId=job.id
    }catch(error){
      const httpStatus=(error as {responseStatus?:number})?.responseStatus
      if(httpStatus&&httpStatus>=400&&httpStatus<500)this.submitted=undefined
      throw error
    }
    this.checked=undefined
    return {accepted:true,taskId:requestId}
  }
}
