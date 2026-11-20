import {readFile} from 'node:fs/promises'
import {resolve,sep} from 'node:path'

export async function frameworkH5Asset(path:string,raw=false){
 if(path.includes('..')||path.includes('\\')||!/^[-\w./]+$/.test(path))return null
 // Development keeps the gateway running while framework client output changes.
 // Production uses only the assets embedded in the verified framework build.
 if(process.env.NODE_ENV==='development'&&process.env.QICORE_DEV_WORKSPACE){
  const root=resolve('../client/dist/h5'),file=resolve(root,path)
  if(!file.startsWith(root+sep))return null
  try{const bytes=await readFile(file);return raw?bytes:path.endsWith('.json')?JSON.parse(bytes.toString('utf8')):bytes.toString('utf8')}catch(error:any){if(error.code==='ENOENT')return null;throw error}
 }
 const assets=useStorage('assets:framework-h5')
 return raw?assets.getItemRaw(path):assets.getItem(path)
}
