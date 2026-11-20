export type ScheduleMode='minutes'|'hourly'|'daily'|'weekly'|'custom'
export type SchedulePreset={mode:ScheduleMode;interval:number;minute:number;time:string;weekday:number}
export function schedulePreset(rule:string):SchedulePreset{
  const result:SchedulePreset={mode:'custom',interval:5,minute:0,time:'03:00',weekday:1},parts=rule.trim().split(/\s+/)
  if(parts.length!==5)return result
  const [m,h,d,month,week]=parts
  if(d!=='*'||month!=='*')return result
  if(h==='*'&&week==='*'&&/^\*\/\d+$/.test(m!)){const n=Number(m!.slice(2));if([1,5,10,15,20,30].includes(n))return{...result,mode:'minutes',interval:n}}
  if(rule.trim()==='* * * * *')return{...result,mode:'minutes',interval:1}
  if(!/^\d+$/.test(m!)||Number(m)>59)return result
  if(h==='*'&&week==='*')return{...result,mode:'hourly',minute:Number(m)}
  if(!/^\d+$/.test(h!)||Number(h)>23)return result
  const time=h!.padStart(2,'0')+':'+m!.padStart(2,'0')
  if(week==='*')return{...result,mode:'daily',time}
  if(/^[0-6]$/.test(week!))return{...result,mode:'weekly',time,weekday:Number(week)}
  return result
}
export function scheduleRule(p:SchedulePreset){
  if(p.mode==='minutes')return p.interval===1?'* * * * *':`*/${p.interval} * * * *`
  if(p.mode==='hourly')return `${p.minute} * * * *`
  const [h,m]=p.time.split(':').map(Number)
  if(!Number.isInteger(h)||!Number.isInteger(m)||h!<0||h!>23||m!<0||m!>59)return ''
  return `${m} ${h} * * ${p.mode==='weekly'?p.weekday:'*'}`
}
export function scheduleDescription(p:SchedulePreset){
  if(p.mode==='minutes')return `每隔 ${p.interval} 分钟执行一次`
  if(p.mode==='hourly')return `每小时的第 ${p.minute} 分钟执行`
  if(p.mode==='daily')return `每天 ${p.time||'请选择时间'} 执行`
  if(p.mode==='weekly')return `每周${['日','一','二','三','四','五','六'][p.weekday]} ${p.time||'请选择时间'} 执行`
  return '按自定义规则执行'
}
