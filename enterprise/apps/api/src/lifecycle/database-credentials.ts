// Adapted from school-shop lifecycle; product identity and state are independent.
import { z } from 'zod';

export const databaseNameSchema = z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/);
export const databaseConnectionSchema = z.object({ host: z.string().min(1).max(253).regex(/^[A-Za-z0-9.:-]+$/),
  port: z.number().int().min(1).max(65535), database: databaseNameSchema,
  username: z.string().min(1).max(100).regex(/^[^\0\r\n]+$/), password: z.string().min(1).max(256).refine(value => !value.includes('\0')) }).strict();
export type DatabaseAccountMode = 'auto' | 'existing';

export function parseMigrationUrl(value: string, mode: DatabaseAccountMode = 'auto') {
  const url = new URL(value), username = decodeURIComponent(url.username), password = decodeURIComponent(url.password), database = decodeURIComponent(url.pathname.slice(1));
  if (!['auto', 'existing'].includes(mode) || url.protocol !== 'mysql:' || url.hash || !url.hostname || !databaseNameSchema.safeParse(database).success
    || !username || username.length > 100 || /[\0\r\n]/.test(username) || !password || password.length > 256 || password.includes('\0')
    || mode === 'auto' && (!/^zjz_mig_[a-f0-9]{20}$/.test(username) || !/^[a-f0-9]{64}$/.test(password))
    || mode === 'existing' && username.toLowerCase() === 'root') throw new Error('INVALID_INSTALL_CREDENTIALS');
  return { url, username, password, database };
}

export function mysqlClientConfig(value: string, mode: DatabaseAccountMode = 'auto') {
  const { url, username, password } = parseMigrationUrl(value, mode);
  const quote = (input: string) => '"' + input.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t') + '"';
  return `[client]\nhost=${quote(url.hostname)}\nport=${url.port || '3306'}\nuser=${quote(username)}\npassword=${quote(password)}\n`;
}
