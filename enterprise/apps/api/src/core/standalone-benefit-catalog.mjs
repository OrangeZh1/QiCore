import { z } from 'zod'
import { fail } from './errors.mjs'

const kind='service_count'
const maxPackages=200
const price=z.number().int().min(0).max(100000000)
const fields=[
  {key:'count',label:'服务次数',unit:'次',min:1,max:1000000},
  {key:'validDays',label:'有效天数',unit:'天',min:1,max:3650,optional:true},
]
const packageInput=z.object({
  name:z.string().trim().min(1).max(64),type:z.literal(kind),priceCents:price,
  originalPriceCents:price.nullable().optional(),badge:z.string().trim().max(20).default(''),
  image:z.string().max(120000).nullable().optional(),enabled:z.boolean(),
  benefits:z.object({count:z.number().int().min(1).max(1000000),validDays:z.number().int().min(1).max(3650).nullable().optional()}).strict(),
}).strict()
export const frameworkPackages={
  catalog:{currency:'CNY',maxPriceCents:100000000,maxPackages,types:[{key:kind,label:'服务次数包',fields}]},
  normalize(value){
    const result=packageInput.safeParse(value)
    if(!result.success||result.data.originalPriceCents!=null&&result.data.originalPriceCents<result.data.priceCents)fail('PACKAGE_INPUT_INVALID','请检查服务包名称、价格与权益规格')
    return result.data
  },
  items:config=>config.packages||[],
  save(config,id,pkg){
    const rows=config.packages??=[],i=rows.findIndex(row=>row.id===id)
    if(i<0&&rows.length>=maxPackages)fail('PACKAGE_LIMIT','服务套餐数量已达上限')
    const item={...pkg,id,image:pkg.image??null,currency:'CNY',originalPriceCents:pkg.originalPriceCents??null}
    if(i<0) rows.push(item)
    else rows[i]=item
  },
  setEnabled(config,id,enabled){config.packages.find(row=>row.id===id).enabled=enabled},
  remove(config,ids){config.packages=config.packages.filter(row=>!ids.includes(row.id))},
}
