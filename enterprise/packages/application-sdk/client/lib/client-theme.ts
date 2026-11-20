import {computed,ref} from 'vue'
import {runtimeConfig} from './runtime-config'
import {clientPageBackground,decorationTheme} from '@qicore/application-sdk/browser/decoration-contract.mjs'
import type {DecorationTheme} from '@qicore/application-sdk/browser/decoration-types'

export {clientPageBackground}
export const clientTheme=ref<DecorationTheme>(decorationTheme())
export function themeForeground(value:string){const brightness=[1,3,5].map(n=>parseInt(value.slice(n,n+2),16)).reduce((v,c,i)=>v+c*[.299,.587,.114][i]!,0);return brightness>150?'#000000':'#ffffff'}
function blend(color:string,base:string,weight:number){return '#'+[1,3,5].map(n=>Math.round(parseInt(color.slice(n,n+2),16)*weight+parseInt(base.slice(n,n+2),16)*(1-weight)).toString(16).padStart(2,'0')).join('')}
export const clientNavigationInk=computed(()=>clientTheme.value.text)
export const clientThemeVariables=computed(()=>{
 const t=clientTheme.value;return{'page-background':clientPageBackground,primary:t.primary,surface:t.surface,background:t.background,text:t.text,muted:t.muted,'primary-soft':blend(t.primary,t.surface,.07),'primary-tint':blend(t.primary,t.surface,.14),'primary-border':blend(t.primary,t.surface,.45),'primary-disabled':blend(t.primary,t.surface,.4),'primary-ink':blend(t.primary,t.text,.6),'navigation-ink':t.text,'navigation-icon-filter':'brightness(0)'+(themeForeground(t.background)==='#ffffff'?' invert(1)':'')}
})
export const clientThemeStyle=computed(()=>Object.entries(clientThemeVariables.value).map(([key,value])=>'--client-'+key+':'+value).join(';'))
let activeScope='',sequence=0,pending:Promise<void>|null=null
function scope(){const r=runtimeConfig();return [r.apiBase,r.tenantId,r.applicationKey].join('|')}
export function setClientTheme(input:Partial<DecorationTheme>|undefined){
 const theme=decorationTheme();for(const key of ['primary','surface','background','text','muted'] as const)if(/^#[a-f\d]{6}$/i.test(input?.[key]||''))theme[key]=input![key]!
 clientTheme.value=theme
 // #ifdef H5
 for(const [key,value] of Object.entries(clientThemeVariables.value))document.documentElement.style.setProperty('--client-'+key,value)
 for(const route of (window as any).__uniRoutes||[]){route.meta.navigationBar||={};Object.assign(route.meta.navigationBar,{backgroundColor:clientPageBackground,titleColor:theme.text})}
 // #endif
}
export function applyNavigationTheme(){
 const {text}=clientTheme.value,background=clientPageBackground
 uni.setNavigationBarColor({backgroundColor:background,frontColor:themeForeground(background),animation:{duration:0,timingFunc:'linear'},fail:()=>{}})
 // #ifdef H5
 for(const route of (window as any).__uniRoutes||[])if(route.meta.navigationBar)route.meta.navigationBar.titleColor=text
 // #endif
}
export function refreshClientTheme(){
 const current=scope();if(current!==activeScope){sequence++;activeScope=current;pending=null;setClientTheme((runtimeConfig() as any).theme)}
 applyNavigationTheme();if(pending)return pending
 const attempt=++sequence,runtime=runtimeConfig()
 const request=new Promise<void>(resolve=>uni.request({url:runtime.apiBase+'/consumer/auth/settings?tenantId='+encodeURIComponent(runtime.tenantId)+'&applicationKey='+encodeURIComponent(runtime.applicationKey),method:'GET',success:response=>{const theme=(response.data as {data?:{theme?:DecorationTheme}}).data?.theme;if(theme&&response.statusCode===200&&attempt===sequence&&scope()===current){setClientTheme(theme);applyNavigationTheme()}},complete:()=>resolve()}))
 pending=request;void request.finally(()=>{if(pending===request)pending=null});return request
}
export function initializeClientTheme(){activeScope=scope();setClientTheme((runtimeConfig() as any).theme)}
