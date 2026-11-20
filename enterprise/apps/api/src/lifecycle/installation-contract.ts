// Adapted from school-shop lifecycle; product identity and state are independent.
import { z } from 'zod'

const key = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const timestamp = z.iso.datetime({ offset: true })
export const installationReportSchema = z.object({
  schema: z.literal('installation-event-v1'),
  productId: key,
  domain: z.string().min(1).max(253),
  attemptId: z.string().uuid(),
  sequence: z.number().int().min(0).max(10000),
  status: z.enum(['RUNNING', 'SUCCEEDED', 'FAILED', 'RECOVERY_REQUIRED']),
  phase: z.enum(['start', 'database', 'migration', 'configuration', 'health', 'completion']),
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  startedAt: timestamp,
  occurredAt: timestamp,
  errorCode: z.string().regex(/^[A-Z0-9_]{1,64}$/).nullable(),
  evidenceSha256: digest.nullable(),
  environment: z.object({
    runtime: z.enum(['nodejs', 'php']),
    runtimeVersion: z.string().regex(/^[0-9][0-9A-Za-z.+-]{0,63}$/),
    deployment: z.enum(['docker', 'native']),
    platform: z.enum(['linux/amd64', 'linux/arm64', 'windows/amd64']),
    stage: z.enum(['local', 'test', 'staging', 'production']).optional(),
  }).strict(),
}).strict().superRefine((event, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (Date.parse(event.occurredAt) < Date.parse(event.startedAt)) issue('Event predates installation')
  if (event.sequence === 0 && (event.status !== 'RUNNING' || event.phase !== 'start')) issue('First event must start installation')
  if (event.status === 'SUCCEEDED' && (event.phase !== 'completion' || !event.evidenceSha256 || event.errorCode)) issue('Success requires completion evidence')
  if (event.status !== 'SUCCEEDED' && event.evidenceSha256) issue('Only completion may carry evidence')
  if (['FAILED', 'RECOVERY_REQUIRED'].includes(event.status) !== Boolean(event.errorCode)) issue('Failure requires an error code')
})
export type InstallationReport = z.infer<typeof installationReportSchema>
