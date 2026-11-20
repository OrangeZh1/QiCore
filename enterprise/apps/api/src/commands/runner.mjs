import {PrismaClient} from '@prisma/client';
import Redis from 'ioredis';
import {commands,splitArguments} from './index.mjs';
import {SystemCache} from '../core/system-cache.mjs';

process.once('disconnect',()=>process.exit(1));
setTimeout(()=>process.exit(1),35000).unref();

process.once('message',async input=>{
  const db=new PrismaClient(),redis=new Redis(process.env.REDIS_URL,{connectTimeout:3000,commandTimeout:5000,maxRetriesPerRequest:0,lazyConnect:true});redis.on('error',()=>{});
  let response={ok:false};
  try{const definition=Object.hasOwn(commands,input.command)?commands[input.command]:null;if(!definition)throw Error('UNKNOWN_COMMAND');const options=definition.parse(splitArguments(input.params));await redis.connect();const result=await definition.run({db,redis,cache:new SystemCache(db,redis),actor:input.actor},options);response={ok:true,cleared:Number.isSafeInteger(result?.cleared)?result.cleared:0}}catch{/* Raw command errors/output may contain credentials; never serialize them. */}
  finally{redis.disconnect();await db.$disconnect().catch(()=>{});process.send?.(response,()=>process.exit(response.ok?0:1))}
});
