import {writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {describeBundle,readProductFile,compositionFilename} from '../apps/api/dist/applications/standalone-bundle.js'
const [stage,productFile,...extra]=process.argv.slice(2)
if(!stage||extra.length)throw Error('用法：node scripts/prepare-standalone-composition.mjs <已装配的运行包目录> [本产品公开配置]')
const root=resolve(stage)
const manifest=await describeBundle(root,productFile?readProductFile(resolve(productFile)):null)
await writeFile(join(root,compositionFilename),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'})
console.log('已生成整包组件清单',compositionFilename,manifest.version)
