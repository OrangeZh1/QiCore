import test from 'node:test'
import assert from 'node:assert/strict'
import {fixtureProduct,signedFixture} from './fixtures/standalone-product.mjs'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {bindWebComponents,standaloneWebComponents} from '../src/applications/standalone-web-inventory.mjs'
import {assertComponentFlag,assertStandaloneComposition} from '../src/applications/standalone-composition.mjs'
import {compositionFilename,describeBundle,verifiedBundle} from '../dist/applications/standalone-bundle.js'
import {loadBundledApplications,loadDevelopmentApplications,createNativeRuntimes} from '../dist/applications/native-catalog.js'
import {setApplicationDefinitions} from '../dist/applications/catalog-state.mjs'
import {applicationCatalog,hasApplicationPermission} from '../dist/applications/registry.mjs'
import {bindStandaloneRelease} from '../dist/applications/standalone-release-state.mjs'
import {StandaloneUpdates} from '../dist/applications/standalone-updates.js'
import {UpdateService} from '../dist/lifecycle/update-service.js'
import {developmentGateway} from '../../../scripts/development/gateway.mjs'

const version='1.0.0'
const main={key:'fixture-main',packageKey:'app_fixture_main',name:'测试主应用',version,pendingTasks:[],format:'qicore-application-v1'}
const plugin=n=>({key:'fixture-addon-'+n,packageKey:'plugin_fixture_'+n,name:'测试扩展 '+n,version,pendingTasks:[],format:'qicore-plugin-v1',
  namespace:'addon'+n,applicationKey:main.key,routes:{admin:[{path:'status',method:'GET',permission:'status.read'}],consumer:[]}})
const members=[main,plugin(1),plugin(2)]
async function temporary(t) {
  const dir=await mkdtemp(join(tmpdir(),'enterprise-composition-'))
  t.after(()=>rm(dir,{force:true,recursive:true}));return dir
}
async function stage(t) {
  const dir=await temporary(t),root=join(dir,'payload')
  await mkdir(join(root,'server'),{recursive:true})
  await writeFile(join(root,'server/start.mjs'),'// disposable package fixture\n')
  await writeFile(join(root,'product.json'),JSON.stringify({version,frameworkVersion:'0.1.10'}))
  for(const descriptor of members){
    const path=join(root,'components',descriptor.packageKey)
    await mkdir(path,{recursive:true});await writeFile(join(path,'application.json'),JSON.stringify(descriptor))
    await writeFile(join(path,'entry.mjs'),`export function createApplication(){
      const key=${JSON.stringify(descriptor.key)};
      return {format:${JSON.stringify(descriptor.format)},version:'1.0.0',
        definition:{key,name:${JSON.stringify(descriptor.name)},licensePackageKey:${JSON.stringify(descriptor.packageKey)},permissions:['status.read'],defaultConfig:()=>({}),validateConfig:v=>v},
        createRuntime(resources){return {key,consumerPaths:[],connect(){resources.events.push('connect:'+key)},initialize(){resources.events.push('init:'+key)},
          tick(allowed){resources.events.push('tick:'+key+':'+allowed)},admin(){return key},consumer(){return key},health(){return true},close(){resources.events.push('close:'+key)}}}
      }}`)
  }
  return {dir,root}
}

test('装配只允许零应用或一个主应用及归属匹配的插件，CLI 区分声明种类',()=>{
  assert.equal(assertStandaloneComposition([]),null)
  assert.equal(assertStandaloneComposition(members).key,main.key)
  assert.throws(()=>assertStandaloneComposition([main,{...main,key:'other-main',packageKey:'app_other'}]),/MULTIPLE_APPLICATIONS/)
  assert.throws(()=>assertStandaloneComposition([plugin(1)]),/OWNER_MISMATCH/)
  assert.throws(()=>assertStandaloneComposition([main,plugin(1),plugin(1)]),/DUPLICATE_COMPONENT/)
  assert.throws(()=>assertStandaloneComposition([main,plugin(1),{...plugin(2),namespace:plugin(1).namespace}]),/NAMESPACE_CONFLICT/)
  assert.throws(()=>assertStandaloneComposition([main,{...plugin(1),applicationKey:'other-main'}]),/OWNER_MISMATCH/)
  assert.throws(()=>assertStandaloneComposition([{...main,packageKey:plugin(1).packageKey}]),/IDENTITY_INVALID/)
  assert.throws(()=>assertComponentFlag('--app',plugin(1)),/TYPE_MISMATCH/)
  assert.throws(()=>assertComponentFlag('--plugin',main),/TYPE_MISMATCH/)
})
test('开发预览网关仅监听回环地址',async t=>{
  const gateway=developmentGateway({port:0,corePort:0,applications:[],token:'fixture-only',status:()=>({ready:true}),shutdown(){}})
  const address=await gateway.listen();t.after(()=>gateway.close())
  assert.equal(address.address,'127.0.0.1')
  assert.deepEqual(await fetch('http://127.0.0.1:'+address.port+'/__qicore_dev/status').then(r=>r.json()),{ready:true})
})
test('开发目录真实加载零应用和主应用加两个插件，插件回调按授权分别执行',async t=>{
  const {root}=await stage(t),env=process.env.NODE_ENV;process.env.NODE_ENV='development'
  t.after(()=>{if(env===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=env})
  assert.deepEqual(createNativeRuntimes((await loadDevelopmentApplications({applications:[]})).applications,{}),[])
  const workspace={applications:members.map(d=>({...d,path:join(root,'components',d.packageKey)}))}
  const {applications}=await loadDevelopmentApplications(workspace)
  setApplicationDefinitions(applications.map(a=>a.definition))
  assert.deepEqual(applicationCatalog().map(app=>app.key),[main.key])
  const events=[],allowed=new Set(members.slice(1).map(d=>d.packageKey))
  const [runtime]=createNativeRuntimes(applications,{db:{},events,pluginAllowed:key=>allowed.has(key)})
  await runtime.connect({});await runtime.initialize();assert.equal(await runtime.health(),true)
  assert.ok(events.includes('init:'+plugin(1).key)&&events.includes('init:'+plugin(2).key))
  const grant=main.key+':plugins.addon1.status.read'
  assert.equal(hasApplicationPermission([grant],main.key,'plugins.addon1.status.read'),true)
  assert.equal(hasApplicationPermission([],main.key,'plugins.addon1.status.read'),false)
  allowed.delete(plugin(1).packageKey)
  assert.equal(hasApplicationPermission([grant],main.key,'plugins.addon1.status.read'),false)
  await runtime.tick(true)
  assert.ok(events.includes('tick:'+plugin(1).key+':false')&&events.includes('tick:'+plugin(2).key+':true'))
  await runtime.close()
})
test('签名整包附带全部组件；替换文件、产品身份及签名均被拒绝',async t=>{
  const {root,dir}=await stage(t),{product,privateKey}=fixtureProduct()
  const composition=await describeBundle(root,product)
  await writeFile(join(root,compositionFilename),JSON.stringify(composition))
  const signed=await signedFixture(root,privateKey),releaseFile=join(dir,'release.json'),productFile=join(dir,'product.json')
  await writeFile(releaseFile,JSON.stringify(signed));await writeFile(productFile,JSON.stringify(product))
  const {components}=await verifiedBundle(root,releaseFile,productFile)
  const {applications,plugins}=await loadBundledApplications(components)
  assert.deepEqual(applications.map(a=>a.definition.key),[main.key]);assert.equal(plugins.length,2)
  await assert.rejects(describeBundle(root,{...product,appKey:'app_other'}),/IDENTITY_MISMATCH/)
  const forged=structuredClone(signed);forged.artifact.signatureEnvelope.signature=Buffer.alloc(64).toString('base64url')
  await writeFile(releaseFile,JSON.stringify(forged));await assert.rejects(verifiedBundle(root,releaseFile,productFile),/SIGNATURE_INVALID/)
  await writeFile(releaseFile,JSON.stringify(signed))
  await writeFile(join(root,'components',plugin(1).packageKey,'entry.mjs'),'export default {}')
  await assert.rejects(verifiedBundle(root,releaseFile,productFile),/LOCAL_RELEASE_MODIFIED/)
})

test('企业整包更新只联系匹配已验证活动回执的产品助手，组件不能拆装',async t=>{
  const {root,dir}=await stage(t),{product,privateKey}=fixtureProduct()
  const manifest=await describeBundle(root,product)
  await writeFile(join(root,compositionFilename),JSON.stringify(manifest))
  const record=await signedFixture(root,privateKey),releaseFile=join(dir,'signed-release.json'),configFile=join(dir,'public-product.json')
  await writeFile(releaseFile,JSON.stringify(record));await writeFile(configFile,JSON.stringify(product))
  const verified=await verifiedBundle(root,releaseFile,configFile)
  bindStandaloneRelease(verified.activeRelease)
  const env=Object.fromEntries(['NODE_ENV','QICORE_STANDALONE_UPDATER_SOCKET'].map(key=>[key,process.env[key]]))
  t.after(()=>{for(const [key,value] of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value}})
  process.env.NODE_ENV='production';process.env.QICORE_STANDALONE_UPDATER_SOCKET=join(dir,'whole-product.sock')
  const state={configured:true,current:{slot:verified.activeRelease.slot,version,frameworkVersion:'0.1.10'},previous:null,job:null}
  let updatesAllowed=true
  const license={standalone:{main:{packageKey:main.packageKey,version}},frameworkVersion:'0.1.10',client:{product,componentStatus:()=>({updatesEligible:updatesAllowed})},
    assertComponentAllowed:(key,type)=>{assert.equal(key,main.packageKey);assert.equal(type,'app')}}
  const paths=[]
  const call=async(path,body,socket)=>{
    assert.equal(socket,process.env.QICORE_STANDALONE_UPDATER_SOCKET)
    paths.push(path)
    if(path==='/status')return state
    if(path==='/check')return{available:true,version:'2.0.0',releaseNotes:'测试整包'}
    if(path==='/apply'){assert.deepEqual(body,{version:'2.0.0'});return{id:'fixture-job',status:'running'}}
    throw Error('UNEXPECTED_HELPER_ROUTE')
  }
  const service=new UpdateService(license,call), helper=new StandaloneUpdates(license,call)
  await assert.rejects(service.applicationOperation({packageKey:plugin(1).packageKey,operation:'uninstall'},true),/整包/)
  const body={requestId:'00000000-0000-4000-8000-000000000321',targetVersion:'2.0.0'}
  await assert.rejects(helper.execute({...body,packageKey:main.packageKey}),/整个产品/)
  state.current.slot='1.0.0-'+('0'.repeat(64))
  await assert.rejects(helper.check(),/ACTIVE_RECEIPT_MISMATCH/)
  state.current.slot=verified.activeRelease.slot
  await helper.check()
  updatesAllowed=false;await assert.rejects(helper.execute(body),/权益/)
  updatesAllowed=true;assert.equal((await helper.execute(body)).accepted,true)
  assert.equal((await helper.execute(body)).accepted,true)
  assert.equal(paths.filter(p=>p==='/apply').length,1)
  assert.ok(!paths.includes('/execute'))
})

test('SSR 忽略未验证的原生路径，只能使用启动前验签的组件清单',()=>{
  assert.deepEqual(standaloneWebComponents({}),{})
  assert.throws(()=>standaloneWebComponents({QICORE_COMPONENTS:'{}'}),/PRELOAD_REQUIRED/)
  assert.throws(()=>standaloneWebComponents({QICORE_STANDALONE_PRODUCT_FILE:'/unverified'}),/PRELOAD_REQUIRED/)
  const issued={app_fixture_main:{type:'app',path:'/verified/active-slot',version:'1.0.0'}}
  bindWebComponents(issued);issued.app_fixture_main.path='/changed'
  assert.equal(standaloneWebComponents({QICORE_COMPONENTS:'{"unverified":{}}'}).app_fixture_main.path,'/verified/active-slot')
  assert.throws(()=>bindWebComponents({}),/ALREADY_BOUND/)
})
