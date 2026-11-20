import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const root=resolve(process.env.INSTANCE_ROOT||'.local/instance')
let value
try{value=JSON.parse(await readFile(join(root,'install-token.json'),'utf8'))}
catch(error){
  if(error.code!=='ENOENT')throw error
  console.error('未找到安装凭据。请先启动 API；已完成安装的实例可以直接登录。')
  process.exitCode=1
}
if(value){
  const url=new URL('/install',process.env.PUBLIC_ORIGIN||'http://127.0.0.1:3000')
  url.hash=new URLSearchParams({token:value}).toString()
  console.log(url.href)
}
