import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {command,start,delay,available,stop} from './processes.mjs';

async function executable(name){const output=await command(process.platform==='win32'?'where.exe':'which',[name]);return output.trim().split(/\r?\n/)[0]}
function sqlCommand(binary,args,sql){return new Promise((ok,fail)=>{const child=spawn(binary,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',data=>output+=data);child.stderr.resume();child.once('error',fail);child.once('close',code=>code===0?ok(output):fail(Error('Development database command failed; existing data was preserved')));child.stdin.end(sql)})}
const redisPath=path=>process.platform==='win32'?'/cygdrive/'+path[0].toLowerCase()+path.slice(2).replaceAll('\\','/'):path;
export async function developmentDatabase({root,state,mysqlPort,redisPort,log}){
 await available(mysqlPort);await available(redisPort);
 const credentialsFile=join(state,'database-credentials.json');let credentials;
 try{credentials=JSON.parse(await readFile(credentialsFile,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error;credentials={database:'qicore_development',user:'qicore_dev',password:randomBytes(24).toString('hex'),rootPassword:randomBytes(24).toString('hex'),redisPassword:randomBytes(24).toString('hex')};await writeFile(credentialsFile,JSON.stringify(credentials),{flag:'wx',mode:0o600})}
 if(credentials.database!=='qicore_development'||credentials.user!=='qicore_dev'||!['password','rootPassword','redisPassword'].every(key=>/^[a-f0-9]{48}$/.test(credentials[key])))throw Error('Development database identity is invalid');
 const mysqld=await executable('mysqld'),mysql=await executable('mysql'),mysqladmin=await executable('mysqladmin'),redis=await executable('redis-server'),redisCli=await executable('redis-cli');
 const data=join(state,'mysql/data'),mysqlLog=join(state,'mysql/mysql.log'),mysqlFiles=join(state,'mysql/files'),redisDir=join(state,'redis');await mkdir(dirname(data),{recursive:true});await mkdir(mysqlFiles,{recursive:true});await mkdir(redisDir,{recursive:true});
 const mysqlOptions=['--no-defaults','--datadir='+data,'--log-error='+mysqlLog,'--secure-file-priv='+mysqlFiles,...process.platform==='win32'?[]:['--socket='+join(state,'mysql/mysql.sock'),'--pid-file='+join(state,'mysql/mysql.pid')]];
 const initialized=await stat(join(data,'auto.cnf')).then(()=>true,()=>false);
 if(!initialized){if(await stat(data).then(()=>true,()=>false))throw Error('Incomplete development MySQL data directory; inspect it before recovery');await mkdir(data);await command(mysqld,[...mysqlOptions,'--initialize-insecure'])}
 const config=join(state,'mysql/client.ini');await writeFile(config,'[client]\nprotocol=tcp\nhost=127.0.0.1\nport='+mysqlPort+'\nuser=root\npassword='+credentials.rootPassword+'\n',{mode:0o600});
 let databaseProcess,redisProcess;
 try{
  databaseProcess=start(mysqld,[...mysqlOptions,'--port='+mysqlPort,'--bind-address=127.0.0.1','--mysqlx=0'],{cwd:state,env:process.env,label:'mysql',log});
  const initial=['--no-defaults','--protocol=tcp','--host=127.0.0.1','--port='+mysqlPort,'--user=root'];
  let ready=false;for(let i=0;i<120;i++){if(databaseProcess.exitCode!==null)throw Error('Development MySQL stopped; inspect '+mysqlLog);try{await command(mysqladmin,initialized?['--defaults-file='+config,'ping']:[...initial,'ping']);ready=true;break}catch{}await delay(250)}if(!ready)throw Error('Development MySQL did not start');
  if(!initialized)await sqlCommand(mysql,initial,"CREATE DATABASE qicore_development CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER 'qicore_dev'@'localhost' IDENTIFIED BY '"+credentials.password+"'; GRANT ALL ON qicore_development.* TO 'qicore_dev'@'localhost'; ALTER USER 'root'@'localhost' IDENTIFIED BY '"+credentials.rootPassword+"';");
  const actual=String(await sqlCommand(mysql,['--defaults-file='+config,'--batch','--skip-column-names'],'SELECT @@datadir;')).trim();if(resolve(actual)!==resolve(data))throw Error('Development MySQL data path mismatch');
  const redisConfig=join(redisDir,'redis.conf');await writeFile(redisConfig,'bind 127.0.0.1\nport '+redisPort+'\nprotected-mode yes\nrequirepass '+credentials.redisPassword+'\ndir "'+redisPath(redisDir)+'"\nsave ""\nappendonly no\npidfile "'+redisPath(join(redisDir,'redis.pid'))+'"\n',{mode:0o600});
  redisProcess=start(redis,[process.platform==='win32'?redisPath(redisConfig):redisConfig],{cwd:dirname(redis),env:process.env,label:'redis',log});
  ready=false;for(let i=0;i<120;i++){if(redisProcess.exitCode!==null)throw Error('Development Redis stopped');try{if((await command(redisCli,['-h','127.0.0.1','-p',String(redisPort),'ping'],{env:{...process.env,REDISCLI_AUTH:credentials.redisPassword}})).trim()==='PONG'){ready=true;break}}catch{}await delay(250)}if(!ready)throw Error('Development Redis did not start');
  const databaseUrl='mysql://qicore_dev:'+credentials.password+'@127.0.0.1:'+mysqlPort+'/qicore_development',redisUrl='redis://:'+credentials.redisPassword+'@127.0.0.1:'+redisPort+'/0';
  const require=createRequire(join(root,'apps/api/package.json'));
  await command(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy','--schema',join(root,'apps/api/prisma/schema.prisma')],{cwd:root,env:{...process.env,DATABASE_URL:databaseUrl}});
  return{databaseUrl,redisUrl,async close(){await command(redisCli,['-h','127.0.0.1','-p',String(redisPort),'shutdown','nosave'],{env:{...process.env,REDISCLI_AUTH:credentials.redisPassword}}).catch(()=>{});await command(mysqladmin,['--defaults-file='+config,'shutdown']).catch(()=>{});await delay(500);await stop(redisProcess);await stop(databaseProcess)}};
 }catch(error){if(redisProcess)await stop(redisProcess);if(databaseProcess){await command(mysqladmin,['--defaults-file='+config,'shutdown']).catch(()=>{});await stop(databaseProcess)}throw error}
}

export async function migrateDevelopmentApplications(root,workspace,databaseUrl){
 const {loadDevelopmentApplications}=await import(pathToFileURL(join(root,'apps/api/dist/applications/native-catalog.js')).href);
 const {createApplicationDatabase}=await import(pathToFileURL(join(root,'apps/api/dist/applications/database.mjs')).href);
 const {assertSafeMigrationSql}=await import(pathToFileURL(join(root,'apps/api/dist/lifecycle/migration-safety.js')).href);
 const {applications,plugins}=await loadDevelopmentApplications(workspace),db=createApplicationDatabase([...applications,...plugins].flatMap(app=>app.database?[app.database]:[]),{datasources:{db:{url:databaseUrl}}});
 try{
  await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS _qicore_development_migrations (owner VARCHAR(64) NOT NULL, id VARCHAR(191) NOT NULL, sha256 CHAR(64) NOT NULL, completed BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY(owner,id))');
  for(const app of workspace.applications){const directory=join(app.path,'migrations'),files=await readdir(directory).catch(error=>{if(error.code==='ENOENT')return[];throw error});
   const applied=await db.$queryRawUnsafe('SELECT id FROM _qicore_development_migrations WHERE owner=?',app.packageKey);
   if(applied.some(row=>!files.includes(row.id)))throw Error('Development migration removed: '+app.key);
   for(const name of files.sort()){
   if(!/^\d{14}_[a-z0-9_]+\.sql$/.test(name))throw Error('Invalid development application migration');
   const sql=await readFile(join(directory,name),'utf8'),hash=createHash('sha256').update(sql).digest('hex'),rows=await db.$queryRawUnsafe('SELECT sha256,completed FROM _qicore_development_migrations WHERE owner=? AND id=?',app.packageKey,name);
   if(rows.length){if(rows[0].sha256!==hash||!rows[0].completed)throw Error('Development migration changed or was interrupted: '+app.key+'/'+name);continue}
   const statements=assertSafeMigrationSql(sql);await db.$executeRawUnsafe('INSERT INTO _qicore_development_migrations(owner,id,sha256) VALUES(?,?,?)',app.packageKey,name,hash);
   for(const statement of statements)await db.$executeRawUnsafe(statement);
   await db.$executeRawUnsafe('UPDATE _qicore_development_migrations SET completed=TRUE WHERE owner=? AND id=?',app.packageKey,name);
  }}
 }finally{await db.$disconnect()}
}
