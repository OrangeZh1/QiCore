import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import client from '../.generated/client/index.js'
import { startInstance } from './installer.mjs'

const application=process.env.APPLICATION_ENTRY
  ? (await import(pathToFileURL(resolve(process.env.APPLICATION_ENTRY)).href)).default
  : null
const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'))
const instance=await startInstance({
  application,
  version,frameworkVersion:version,
  createDb:url=>new client.PrismaClient({datasourceUrl:url}),
  schema:fileURLToPath(new URL('../prisma/schema.prisma',import.meta.url)),
  hooks:application?.installation
})

for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
  instance.close().catch(()=>{process.exitCode=1})
})
