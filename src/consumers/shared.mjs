import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'

export function reject(status, message) { throw Object.assign(new Error(message), { status }) }
export const conflict = () => reject(409, '记录已变更，请刷新后重试')
export const version = z.number().int().min(0)
export const id = z.uuid()
export const userIdInput = z.string().trim().min(1).max(64).regex(/^[^\u0000-\u001f\u007f/]+$/)
export const description = z.string().trim().max(200).default('')
export const paging = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}
export function pageRange(q, total) {
  const page = Math.min(q.page, Math.max(1, Math.ceil(total / q.pageSize)))
  return { page, skip: (page - 1) * q.pageSize, take: q.pageSize }
}
export const hash = input => createHash('sha256').update(JSON.stringify(input)).digest('hex')
export const transaction = (db, fn) => db.$transaction(fn, { isolationLevel: 'Serializable' })
export function audit(tx, actor, action, scope, details) {
  return tx.coreAuditEvent.create({ data: { id: randomUUID(), actor, action, details: { scope, ...details } } })
}
export async function activeConsumer(db, scope, userId) {
  const row = await db.coreConsumer.findUnique({ where: { scope_userId: { scope, userId } } })
  if (!row || row.deletedAt) reject(404, '用户不存在')
  if (!row.enabled) reject(409, '用户已停用')
  return row
}
