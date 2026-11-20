import {randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {fail} from './errors.mjs';
import {tenantManagementPermissions} from './tenant-access.mjs';
import {frameworkPermissions,frameworkGrant} from '../applications/framework.mjs';
const scrypt=promisify(scryptCallback);
export const platformPermissions=['overview.read','tenants.read','tenants.write','accounts.read','accounts.write','roles.read','roles.write','settings.read','settings.write','materials.read','materials.write','cache.read','cache.clear','tasks.read','tasks.write','backups.read','backups.create','backups.download','backups.delete','backups.restore','audit.read','services.read','services.update'];
export const foundationTenantPermissions=[...tenantManagementPermissions,'tenant:settings.read','tenant:settings.write',...frameworkPermissions.map(frameworkGrant)];
export const passwordValue=(v,minimum=6)=>{if(typeof v!=='string'||v.length<minimum||v.length>128)fail('PASSWORD_INVALID',`密码须为 ${minimum}–128 个字符`);return v};
export async function passwordHash(password,minimum=6){passwordValue(password,minimum);const salt=randomBytes(16).toString('hex');const key=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});return `scrypt$${salt}$${key.toString('hex')}`;}
export async function passwordMatches(password,stored){if(typeof password!=='string'||password.length>128||typeof stored!=='string')return false;const parts=stored.split('$');if(parts.length!==3||parts[0]!=='scrypt'||! /^[a-f0-9]{32}$/.test(parts[1])||! /^[a-f0-9]{128}$/.test(parts[2]))return false;const actual=await scrypt(password,parts[1],64,{N:16384,r:8,p:1,maxmem:64*1024*1024});return timingSafeEqual(actual,Buffer.from(parts[2],'hex'));}
