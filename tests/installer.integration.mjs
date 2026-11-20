import assert from 'node:assert/strict'
import {fork} from 'node:child_process'
import {once} from 'node:events'
import {readFile,stat} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomBytes} from 'node:crypto'
import generated from '../.generated/client/index.js'
import {migrate,startInstance} from '../src/installer.mjs'
import {passwordHash} from '../src/identity.mjs'

const database=process.env.DATABASE_URL
if(!database||new URL(database).pathname!=='/qc_fixture_install'||!process.env.INSTALLER_TEST_ROOT)throw Error('请使用独立 MySQL 安装验收脚本')
const stateRoot=resolve(process.env.INSTALLER_TEST_ROOT)
const schema=fileURLToPath(new URL('../prisma/schema.prisma',import.meta.url))
const appOptions={stateRoot,createDb:url=>new generated.PrismaClient({datasourceUrl:url}),schema,port:0}
const read=async file=>JSON.parse(await readFile(file,'utf8'))
const secret=randomBytes(24).toString('hex')
const post=(url,body)=>fetch(url+'/api/install/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
const origin=instance=>'http://127.0.0.1:'+instance.listener.address().port
const pause=ms=>new Promise(r=>setTimeout(r,ms))

if(process.argv[2]==='--hold'){
  const instance=await startInstance({...appOptions,hooks:{beforeInstall:async({attemptId})=>{
    process.send({locked:attemptId})
    await new Promise(()=>{})
  }}})
  process.send({url:origin(instance)})
}else{
  const worker=fork(fileURLToPath(import.meta.url),['--hold'],{stdio:['ignore','inherit','inherit','ipc']})
  const [hello]=await once(worker,'message')
  const firstToken=await read(join(stateRoot,'install-token.json'))
  const input={token:firstToken,database,login:'installer-admin',password:secret}
  const locked=once(worker,'message')
  const interrupted=post(hello.url,input).catch(()=>null)
  const [attempt]=await locked
  let offline=true,observedReceipt,authorized=true
  const resumed=await startInstance({...appOptions,hooks:{
    mountPublicRoutes(router){router.get('/test-application-hook',(_req,res)=>res.send('ok'))},
    beforeInstall:async({attemptId})=>assert.equal(attemptId,attempt.locked),
    afterInstall:async({receipt})=>{observedReceipt=receipt;if(offline)throw Error('fixture after-commit failure')},
    authorizeRequest:async()=>authorized
  }})
  let reopened
  try{
    const url=origin(resumed)
    assert.equal((await fetch(url+'/test-application-hook')).status,200)
    assert.equal((await (await fetch(url+'/api/install/status')).json()).installed,false)
    assert.equal((await post(url,{...input,token:'a'.repeat(40)})).status,403)
    assert.equal((await post(url,input)).status,409)
    const exited=once(worker,'exit')
    worker.kill('SIGKILL')
    await exited;await interrupted
    const invalidDb=database.replace('/qc_fixture_install','/qc_fixture_foreign')
    assert.equal((await post(url,{...input,database:invalidDb})).status,409)
    const installed=await post(url,input)
    assert.equal(installed.status,200,await installed.text())
    const complete=await read(join(stateRoot,'installed.json'))
    assert.equal(complete.attemptId,attempt.locked);assert.equal(complete.accountId,observedReceipt.accountId)
    assert.ok(!JSON.stringify(complete).includes(database))
    assert.ok(!JSON.stringify(await read(join(stateRoot,'install-attempt.json'))).includes(secret))
    assert.equal((await stat(join(stateRoot,'database.json'))).mode&0o777,0o600)
    assert.equal((await post(url,input)).status,409)
    authorized=false
    assert.equal((await fetch(url+'/api/health')).status,403)
    authorized=true
    const login=await fetch(url+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:input.login,password:input.password})})
    assert.equal(login.status,200);assert.ok(login.headers.get('set-cookie'))
    assert.equal((await fetch(url+'/api/health')).status,200)
    offline=false
    await resumed.close()
    reopened=await startInstance({...appOptions,hooks:{afterInstall:async({receipt})=>{assert.equal(receipt.attemptId,attempt.locked)}}})
    for(let i=0;i<100 && (await read(join(stateRoot,'install-attempt.json'))).phase!=='complete';i++)await pause(10)
    assert.equal((await read(join(stateRoot,'install-attempt.json'))).phase,'complete')
    assert.equal((await (await fetch(origin(reopened)+'/api/install/status')).json()).installed,true)
    console.log('PASS 空库首装、并发锁、进程中断后恢复、应用钩子与落盘重启')
  }finally{
    if(worker.exitCode===null && !worker.signalCode)worker.kill('SIGKILL')
    if(!reopened)await resumed.close()
    else await reopened.close()
  }

  const prior=database.replace('/qc_fixture_install','/qc_fixture_cli')
  await migrate(schema,prior)
  const cli=appOptions.createDb(prior)
  const account=await cli.account.create({data:{login:'original-admin',displayName:'原管理员',roleId:'admin',passwordHash:await passwordHash(secret)}})
  await cli.$disconnect()
  const otherRoot=stateRoot+'-cli',second=await startInstance({...appOptions,stateRoot:otherRoot})
  try{
    const setup={token:await read(join(otherRoot,'install-token.json')),database:database.replace('/qc_fixture_install','/qc_fixture_foreign'),login:account.login,password:secret}
    assert.equal((await post(origin(second),setup)).status,409)
    setup.database=prior
    assert.equal((await post(origin(second),{...setup,password:'a-wrong-password'})).status,409)
    const result=await post(origin(second),setup)
    assert.equal(result.status,200,await result.text())
    assert.equal((await read(join(otherRoot,'installed.json'))).accountId,account.id)
    console.log('PASS 拒绝陌生非空库、原 CLI 管理员身份复核接入')
  }finally{await second.close()}
}
