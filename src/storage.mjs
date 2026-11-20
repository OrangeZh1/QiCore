import { mkdir, open, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
export function privateStorage(root) {
  const folder = resolve(root)
  function location(id){
    if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) throw Error('无效的文件标识')
    return resolve(folder,id)
  }
  return {
    async write(bytes) {
      if (!Buffer.isBuffer(bytes) || bytes.length > 8 * 1024 * 1024) throw Error('无效的文件')
      await mkdir(folder,{recursive:true,mode:0o700})
      const id = randomUUID()
      const file = await open(resolve(folder,id),'wx',0o600)
      try { await file.writeFile(bytes) } finally { await file.close() }
      return id
    },
    async read(id) {
      return open(location(id),'r')
    },
    async remove(id){
      await unlink(location(id))
    }
  }
}
