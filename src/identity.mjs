import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'

const derive = promisify(scrypt)
const options = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
export const digest = token => createHash('sha256').update(token).digest('hex')

export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw Error('密码长度应为 12 至 128 个字符')
  const salt = randomBytes(16).toString('hex')
  const key = await derive(password, salt, 64, options)
  return ['scrypt',salt,key.toString('hex')].join('$')
}
export async function passwordMatches(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false
  const match = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(stored)
  if (!match) return false
  return timingSafeEqual(await derive(password, match[1], 64, options), Buffer.from(match[2], 'hex'))
}
export function can(account, permission) {
  return Boolean(account?.enabled && !account.deletedAt && account.role?.enabled !== false && !account.role?.deletedAt && (account.roleId === 'admin' || account.role.permissions.includes(permission)))
}
