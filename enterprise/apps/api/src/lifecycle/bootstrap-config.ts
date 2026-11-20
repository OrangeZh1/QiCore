import {z} from 'zod';
import {nativeConfigSchema} from './native-state.js';

export const bootstrapConfigSchema=z.object({native:nativeConfigSchema.omit({migrationUrl:true}),controlRoot:z.string(),nativeConfigFile:z.string(),archive:z.string(),releaseFile:z.string(),adminOrigin:z.string().url(),redisUrl:z.string().url(),publicPort:z.number().int().min(1024).max(65535).optional(),challengeRoot:z.string().optional()}).strict()
 .refine(v=>v.publicPort===undefined||![Number(new URL(v.native.loginUrl).port||80),Number(new URL(v.native.healthUrl).port||80),v.native.maintenancePort].includes(v.publicPort),'Public and internal ports must differ');
export type BootstrapConfig=z.infer<typeof bootstrapConfigSchema>;
