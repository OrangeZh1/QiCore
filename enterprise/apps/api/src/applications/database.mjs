import {PrismaClient,Prisma} from '@prisma/client';
import {getPrismaClient} from '@prisma/client/runtime/library';
import {createHash} from 'node:crypto';

export const applicationPrismaVersion='6.19.3';
const identifier=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
// Prisma 6's configOverride mutates the generated constructor's closed-over config.
// Capture the unextended configuration and give each composition its own constructor.
let frameworkConfig;
const probe=new PrismaClient({__internal:{configOverride:config=>{frameworkConfig={...config,runtimeDataModel:structuredClone(config.runtimeDataModel)};return config}}});
await probe.$disconnect();

// Prisma's generated config hook is version-specific. Fail closed on upgrades;
// the runtime/archive transaction tests must pass before changing this pin.
export function createApplicationDatabase(fragments=[],options={}){
 if(!fragments.length)return new PrismaClient(options);
 if(Prisma.prismaVersion.client!==applicationPrismaVersion)throw Error('APPLICATION_DATABASE_VERSION_UNSUPPORTED');
 if(options.__internal)throw Error('APPLICATION_DATABASE_OPTIONS_INVALID');
 const ApplicationClient=/** @type {typeof PrismaClient} */ (/** @type {unknown} */ (getPrismaClient({...frameworkConfig,runtimeDataModel:structuredClone(frameworkConfig.runtimeDataModel)})));
 return new ApplicationClient({...options,__internal:{configOverride(base){
  const models={...base.runtimeDataModel.models},names=new Set(Object.keys(models).map(n=>n.toLowerCase()));
  const tables=new Set(Object.entries(models).map(([name,model])=>(model.dbName||name).toLowerCase()));
  const schemas=[base.inlineSchema];
  for(const fragment of fragments){
   if(fragment?.format!=='qicore-prisma-models-v1'||fragment.prismaVersion!==applicationPrismaVersion||typeof fragment.schema!=='string'
    ||!fragment.models||Object.getPrototypeOf(fragment.models)!==Object.prototype)throw Error('APPLICATION_DATABASE_CONTRACT_INVALID');
   const blocks=[...fragment.schema.matchAll(/\bmodel\s+([A-Za-z][A-Za-z0-9_]*)\s*\{[^{}]*\}/g)];
   if(!blocks.length||fragment.schema.replace(/\bmodel\s+[A-Za-z][A-Za-z0-9_]*\s*\{[^{}]*\}/g,'').trim()
    ||blocks.length!==Object.keys(fragment.models).length)throw Error('APPLICATION_DATABASE_SCHEMA_INVALID');
   for(const [block,name] of blocks){
    const model=fragment.models[name],table=model?.dbName||name;
    if(!identifier.test(name)||!identifier.test(table)||!model||!Array.isArray(model.fields)||!model.fields.length
     ||model.fields.some(field=>field.kind!=='scalar'||!identifier.test(field.name)))throw Error('APPLICATION_DATABASE_MODEL_INVALID');
    const mapped=/@@map\("([^"]+)"\)/.exec(block)?.[1]||name;
    if(table!==mapped||names.has(name.toLowerCase())||tables.has(table.toLowerCase()))throw Error('APPLICATION_DATABASE_MODEL_CONFLICT');
    names.add(name.toLowerCase());tables.add(table.toLowerCase());models[name]=model;
   }
   schemas.push(fragment.schema);
  }
  const inlineSchema=schemas.join('\n');
  return {...base,runtimeDataModel:{...base.runtimeDataModel,models},inlineSchema,inlineSchemaHash:createHash('sha256').update(inlineSchema).digest('hex')};
 }}});
}
