import { z } from 'zod'
const key = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/)
const version = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
const image = z.string().max(512).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+(?:\:[0-9]{1,5})?\/[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/)
export const dockerReleaseSchema = z.object({
  schema: z.literal('qilicense-docker-release-v1'),
  productId: key,
  fromVersion: version,
  version,
  releaseNotes: z.string().trim().min(1).max(5000),
  platform: z.literal('linux/amd64'),
  nodeMajor: z.literal(24),
  apiImage: image,
  adminImage: image,
  databaseCompatibility: z.literal('backward-compatible'),
  migrations: z.array(z.object({
    id: z.string().regex(/^[0-9a-z_]{1,100}$/),
    sha256,
  }).strict()).max(500),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.migrations.map(x => x.id)).size !== value.migrations.length) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate migration identity' })
  }
})
export const dockerPlanRequestSchema = z.object({
  schema: z.literal('qilicense-docker-plan-request-v1'),
  capability: z.literal('docker-compose-v1'),
  productId: key,
  domain: z.string().min(1).max(253),
  currentVersion: version,
  platform: z.literal('linux/amd64'),
}).strict()
