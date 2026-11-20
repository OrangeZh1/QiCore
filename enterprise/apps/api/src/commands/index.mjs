import {parseArgs} from 'node:util';

// Application commands are registered here, like framework console commands.
// Each command owns argument validation and may use the supplied db/cache/redis clients.
export const commands={
  'sessions:cleanup':{
    label:'清理过期会话',description:'清理已过期的会话，保留有效登录。',permissions:[],
    parse(argv){const {values}=parseArgs({args:argv,options:{limit:{type:'string',default:'100'}},strict:true,allowPositionals:false});const limit=Number(values.limit);if(!Number.isInteger(limit)||limit<1||limit>500)throw Error('LIMIT');return{limit}},
    async run({db},{limit}){let cleared=0;const now=new Date();for(const [model,key] of [['adminDelegation','tokenHash'],['adminSession','tokenHash'],['session','token']]){const rows=await db[model].findMany({where:{expiresAt:{lte:now}},select:{[key]:true},take:limit,orderBy:{expiresAt:'asc'}});if(rows.length)cleared+=(await db[model].deleteMany({where:{[key]:{in:rows.map(r=>r[key])},expiresAt:{lte:now}}})).count}return{cleared}},
  },
  'cache:clear':{
    label:'清理系统缓存',description:'清理本实例可重建的业务缓存。',permissions:['cache.read','cache.clear'],
    parse(argv){parseArgs({args:argv,options:{},strict:true,allowPositionals:false});return{}},
    run({cache,actor}){return cache.clear(actor)},
  },
  'system:check':{
    label:'检查依赖服务',description:'检测数据库与 Redis 连接。',permissions:['services.read'],
    parse(argv){parseArgs({args:argv,options:{},strict:true,allowPositionals:false});return{}},
    async run({db,redis}){await db.$queryRaw`SELECT 1`;if(await redis.ping()!=='PONG')throw Error('REDIS_UNAVAILABLE');return{}},
  },
};

// Split arguments only; nothing is evaluated or passed to a shell.
export function splitArguments(text){
  if(typeof text!=='string'||text.length>1000||/[\u0000-\u001f\u007f]/.test(text))throw Error('ARGUMENTS');
  const args=[];let value='',quote=null,started=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='\\'&&i+1<text.length&&/[\\"'\s]/.test(text[i+1])){value+=text[++i];started=true}else if(quote){if(c===quote)quote=null;else value+=c}else if(c==='"'||c==="'"){quote=c;started=true}else if(/\s/.test(c)){if(started){args.push(value);value='';started=false}}else{value+=c;started=true}}
  if(quote)throw Error('UNTERMINATED_QUOTE');if(started)args.push(value);if(args.length>100)throw Error('ARGUMENTS');return args;
}
