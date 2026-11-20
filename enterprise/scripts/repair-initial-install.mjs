// Build a standalone customer file with esbuild; never place it inside bootstrap's verified inventory.
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {verifyBootstrapInventory} from './bootstrap-inventory.mjs';
import {reconcileInitialInstall} from '../apps/api/src/lifecycle/initial-install-repair.ts';
import {noLinks} from '../apps/api/src/lifecycle/native-files.ts';

const messages={
 INSTALL_REPAIR_RUNNING:'请先在宝塔停止 bootstrap Node 项目，再运行本命令。',
 INSTALL_REPAIR_RECOVERY_REQUIRED:'发现已有安装、恢复记录或非空数据目录，已停止；请保留现场处理恢复。',
 INSTALL_DATABASE_NOT_EMPTY:'数据库已有表，已停止；不能按空实例修复或重新安装。',
 INSTALL_CONFIG_CHANGED:'两份私有配置不一致，已停止；请先核对配置修改记录。',
 INSTALL_SOURCE_IDENTITY_CHANGED:'交付包与旧配置的产品身份或可信公钥不同，已停止。',
 INSTALL_SOURCE_LAYOUT_CHANGED:'交付包与旧配置的代码目录不同，已停止；请核对 --root。',
 INSTALL_SOURCE_DOWNGRADE_REJECTED:'当前交付包版本低于原配置，已停止，不能自动降级。',
 INSTALL_REPAIR_CONFLICT:'配置修复中出现其他修改，已停止；请保留 initial-source-repair.json。',
 INSTALL_REPAIR_PENDING:'存在未完成的配置修复。停止项目后，使用同一命令加 --apply 继续。',
 INSTALL_REPAIR_DEPLOYMENT_PENDING:'存在未完成的部署配置同步，已停止；请先恢复原事务，再修复安装包配置。',
 INSTALL_ARCHIVE_MISSING:'当前交付包缺少运行 ZIP，请重新上传完整的同版本安装包。',
 BOOTSTRAP_ARCHIVE_INVALID:'安装 ZIP 大小或哈希与发行材料不匹配，已停止。',
 PRIVATE_INSTALL_CONFIG_REQUIRED:'私有配置必须是独立普通文件，权限为 600，已停止。',
 PRIVATE_INSTALL_CONFIG_OWNER:'当前账号与私有配置属主不同，已停止；请使用该实例原来的控制器账号执行，不要批量修改属主。',
 P1000:'无法用保留的数据库账号登录，未修改配置；请先核对数据库凭据。',P1001:'无法连接保留配置中的数据库，不能确认空库，未修改配置。',P1003:'保留配置中的数据库不存在，未修改配置。',P1010:'保留的数据库账号无权访问目标库，未修改配置。',
};
async function main(){
 const args=process.argv.slice(2),value=flag=>{const index=args.indexOf(flag);return index<0?undefined:args[index+1]};
 if(args.includes('--help')||!value('--root')){console.log('用法：node qicore-install-repair.mjs --root /www/wwwroot/域名 [--config /www/server/nodejs-env/qicore/bootstrap.json] [--apply]\n默认仅检查；--apply 保存原配置并修复。运行前请在宝塔停止 bootstrap。');return}
 if(process.platform!=='linux'||process.versions.node.split('.')[0]!=='24')throw Error('LINUX_NODE24_REQUIRED');
 const root=resolve(value('--root')),bootstrap=join(root,'bootstrap'),configPath=resolve(value('--config')||'/www/server/nodejs-env/qicore/bootstrap.json');
 noLinks(root);noLinks(configPath);
 const config=JSON.parse(readFileSync(configPath,'utf8')),lock=join(config.controlRoot,'controller.lock');noLinks(lock);
 if(!existsSync(lock)||!lstatSync(lock).isFile())throw Error('INSTALL_CONTROLLER_LOCK_MISSING');
 if(process.env.QICORE_REPAIR_FLOCK!=='1'){
  const result=spawnSync('flock',['--exclusive','--nonblock','--conflict-exit-code','73',lock,process.execPath,process.argv[1],...args],{env:{...process.env,QICORE_REPAIR_FLOCK:'1'},stdio:'inherit',timeout:120000});
  if(result.status===73)throw Error('INSTALL_REPAIR_RUNNING');
  if(result.error)throw Error('INSTALL_REPAIR_LOCK_FAILED');
  process.exitCode=result.status??1;return;
 }
 await verifyBootstrapInventory(bootstrap);
 const controller=await import(pathToFileURL(join(bootstrap,'controller.mjs')).href);
 const {config:candidate}=await controller.prepareBootstrapConfig(bootstrap,configPath);
 const checkDatabase=async url=>{
  const require=createRequire(join(bootstrap,'controller.mjs')),{PrismaClient}=require('@prisma/client');
  const db=new PrismaClient({datasources:{db:{url:url+(url.includes('?')?'&':'?')+'connect_timeout=5&pool_timeout=5'}}});
  try{await db.$connect();const rows=await db.$queryRawUnsafe('SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');if(String(rows[0].total)!=='0')throw Error('INSTALL_DATABASE_NOT_EMPTY')}
  finally{await db.$disconnect()}
 };
 process.env.PRISMA_QUERY_ENGINE_LIBRARY=join(bootstrap,'node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node');
 const result=await reconcileInitialInstall(configPath,candidate,checkDatabase,args.includes('--apply'));
 console.log(JSON.stringify(result,null,2));
 console.log(result.applied?'修复检查完成。请在宝塔启动 bootstrap，从最新安装链接返回安装须知，重新填写数据库和管理员密码后安装。':'检查完成，未修改配置。确认修复请使用同一命令加 --apply。');
}
await main().catch(error=>{
 const code=typeof error?.message==='string'&&/^[A-Z][A-Z0-9_]{1,63}$/.test(error.message)?error.message:error?.code||error?.errorCode||'INSTALL_REPAIR_FAILED';
 console.error(code+': '+(messages[code]||'检查未完成，未启动安装。请把此错误码提供给维护人员；保留原配置和修复记录。'));process.exitCode=1;
});
