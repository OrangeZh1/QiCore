import { db } from '../src/db.mjs'
import { passwordHash } from '../src/identity.mjs'
const login = process.env.ADMIN_LOGIN?.trim()
if (!login || !/^[\w.@-]{2,80}$/.test(login)) throw Error('设置 ADMIN_LOGIN 和 ADMIN_PASSWORD 后运行')
try {
  const password = await passwordHash(process.env.ADMIN_PASSWORD)
  await db.account.create({data:{login,displayName:login,passwordHash:password,roleId:'admin'}})
  console.log('已创建系统管理员')
} finally { await db.$disconnect() }
