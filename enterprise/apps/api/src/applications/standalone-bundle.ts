import {join,isAbsolute} from 'node:path'
import {createReadStream,lstatSync,readFileSync,readdirSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import {canonicalJson} from '../license/contracts.js'
import {validateProduct,type Product} from '../license/client.js'
import {noLinks,verifyNativeTree} from '../lifecycle/native-files.js'
import {componentDescriptorSchema} from './native-descriptor.js'
import {assertStandaloneComposition} from './standalone-composition.mjs'
import {nativeArchiveFromCatalog,nativePathSchema} from './standalone-archive.js'
import {verifyNativeInitialRelease,verifyNativeRelease,sha256} from './standalone-release.js'
import type {NativeComponents} from './native-catalog.js'

export const compositionFilename = 'standalone-components.json'
const version = /^\d+\.\d+\.\d+$/
const productInfo = z.object({version:z.string().regex(version),frameworkVersion:z.string().regex(version)})
type FileEntry = {path:string;size:number;sha256:string}
function readJson(path:string) {
  noLinks(path)
  const file=lstatSync(path)
  if(!file.isFile()||file.nlink!==1)throw Error('BUNDLE_FILE_INVALID')
  return JSON.parse(readFileSync(path,'utf8'))
}

async function componentFiles(root:string):Promise<FileEntry[]> {
  const files:FileEntry[]=[]
  async function walk(dir:string,prefix:string) {
    for(const name of readdirSync(dir).sort()){
      const path=nativePathSchema.parse(prefix+name),file=join(dir,name),stat=lstatSync(file)
      if(stat.isDirectory()){await walk(file,path+'/');continue}
      if(!stat.isFile()||stat.nlink!==1)throw Error('BUNDLE_FILE_INVALID')
      const hash=createHash('sha256')
      for await(const chunk of createReadStream(file))hash.update(chunk)
      files.push({path,size:stat.size,sha256:hash.digest('hex')})
    }
  }
  await walk(root,'')
  return files
}

export function readProductFile(path:string) {
  if(!path||!isAbsolute(path))throw Error('STANDALONE_PRODUCT_FILE_REQUIRED')
  const product:Product=readJson(path)
  if(product.componentType!=='app'||product.deliveryKind!=='archive'||!product.appKey?.startsWith('app_')||product.product==='qicore-local-development')throw Error('STANDALONE_PRODUCT_INVALID')
  return product
}

// Components have fixed, relative locations inside the single verified product slot.
// The same calculation is used when preparing the payload and when opening it.
export async function describeBundle(root:string,product:Product|null,verifiedFiles?:FileEntry[]) {
  if(!isAbsolute(root))throw Error('BUNDLE_ROOT_INVALID')
  noLinks(root)
  const start=join(root,'server','start.mjs')
  noLinks(start)
  if(!lstatSync(start).isFile())throw Error('BUNDLE_START_ENTRY_REQUIRED')
  const meta=productInfo.parse(readJson(join(root,'product.json')))
  if(product)validateProduct({...product,version:meta.version})
  const folder=join(root,'components')
  noLinks(folder)
  const names=existsSync(folder)?readdirSync(folder).sort():[]
  const entries=names.map(packageKey=>{
    if(!/^(app|plugin|plg)_[a-z0-9_]+$/.test(packageKey))throw Error('BUNDLE_COMPONENT_DIRECTORY_INVALID')
    const directory=join(folder,packageKey)
    noLinks(directory)
    const descriptor=componentDescriptorSchema.parse(readJson(join(directory,'application.json')))
    if(descriptor.packageKey!==packageKey)throw Error('BUNDLE_PACKAGE_KEY_MISMATCH')
    return {directory,descriptor}
  })
  const primary=assertStandaloneComposition(entries.map(e=>e.descriptor))
  if((product?.appKey??null)!==(primary?.packageKey??null)||(primary&&primary.version!==meta.version))throw Error('BUNDLE_PRODUCT_IDENTITY_MISMATCH')
  if(primary&&(!product||product.componentType!=='app'||product.deliveryKind!=='archive'))throw Error('BUNDLE_PRODUCT_IDENTITY_MISMATCH')
  const parts=[]
  for(const {directory,descriptor} of entries){
    const prefix='components/'+descriptor.packageKey+'/'
    const files=verifiedFiles?verifiedFiles.filter(f=>f.path.startsWith(prefix)).map(f=>({...f,path:f.path.slice(prefix.length)})):await componentFiles(directory)
    files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)
    if(!files.some(f=>f.path==='entry.mjs')||new Set(files.map(f=>f.path.toLowerCase())).size!==files.length)throw Error('BUNDLE_COMPONENT_LAYOUT_INVALID')
    const required=['application.json']
    if(descriptor.web?.admin)required.push(descriptor.web.admin.entrypoint)
    if(descriptor.format==='qicore-application-v1'&&descriptor.web?.h5)required.push(descriptor.web.h5.directory+'/index.html',descriptor.web.h5.directory+'/h5-routes.json')
    if(descriptor.format==='qicore-application-v1'&&descriptor.web?.miniProgram)required.push(descriptor.web.miniProgram.manifest)
    if(required.some(path=>!files.some(f=>f.path===path)))throw Error('BUNDLE_COMPONENT_LAYOUT_INVALID')
    const plugin=descriptor.format==='qicore-plugin-v1'
    parts.push({key:descriptor.key,packageKey:descriptor.packageKey,type:plugin?'plugin' as const:'app' as const,
      version:descriptor.version,entrypoint:'entry.mjs',filesSha256:sha256(canonicalJson(files)),
      ...(plugin?{namespace:descriptor.namespace,applicationKey:descriptor.applicationKey,parentApp:descriptor.applicationKey==='*'?null:primary!.packageKey}:{})})
  }
  return {format:'qicore-standalone-composition-v1',productKey:product?.appKey??null,version:meta.version,frameworkVersion:meta.frameworkVersion,components:parts}
}

export async function verifiedBundle(root:string,releaseFile:string,configFile:string) {
  if(!isAbsolute(root)||!isAbsolute(releaseFile))throw Error('STANDALONE_RECEIPT_REQUIRED')
  const product=readProductFile(configFile),input=readJson(releaseFile)
  validateProduct({...product,version:input.version})
  const release=input.format==='qicore-initial-release-v1'?verifyNativeInitialRelease(product,input):verifyNativeRelease(product,input)
  const manifest=nativeArchiveFromCatalog(release.manifest)
  await verifyNativeTree(root,manifest)
  const expected=await describeBundle(root,product,manifest.files)
  if(release.manifest.entrypoint!=='server/start.mjs'||release.version!==expected.version||canonicalJson(readJson(join(root,compositionFilename)))!==canonicalJson(expected))throw Error('BUNDLE_RECEIPT_MISMATCH')
  const components:NativeComponents={}
  for(const part of expected.components)components[part.packageKey]={
    version:part.version,manifestSha256:part.filesSha256,path:join(root,'components',part.packageKey),type:part.type,entrypoint:part.entrypoint,
    ...(part.type==='plugin'?{parentApp:part.parentApp}:{})
  }
  return {components,composition:expected,activeRelease:{productKey:product.appKey!,version:release.version,frameworkVersion:expected.frameworkVersion,slot:release.version+'-'+release.artifact.manifestSha256}}
}
