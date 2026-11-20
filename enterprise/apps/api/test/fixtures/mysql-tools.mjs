import {dirname,join} from 'node:path';

// CI connects through a private Docker bridge; local Windows tests use localhost.
export function testDatabaseAccount(env=process.env){
 const host=env.TEST_DATABASE_ACCOUNT_HOST||'localhost';
 if(!['localhost','%'].includes(host))throw Error('Unsupported isolated-test MySQL account host');
 const user=decodeURIComponent(new URL(env.TEST_DATABASE_URL).username);
 if(!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(user)||user==='root')throw Error('Isolated tests require a non-root test account');
 return "'"+user+"'@'"+host+"'";
}
export function testMysqlClient(env=process.env,platform=process.platform){
 if(env.BACKUP_MYSQL_PATH)return env.BACKUP_MYSQL_PATH;
 if(!env.BACKUP_MYSQLDUMP_PATH)throw Error('BACKUP_MYSQLDUMP_PATH is required');
 return join(dirname(env.BACKUP_MYSQLDUMP_PATH),platform==='win32'?'mysql.exe':'mysql');
}
