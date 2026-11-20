import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// Exercise real Nginx with BaoTa's default static /.well-known and whole-site
// proxy semantics. Legacy exact routes are an explicit, separate compatibility case.
export async function startBootstrapNginx(root,webRoot,port,upstreamPort,maintenancePort){
 await mkdir(root,{recursive:true});
 const config=join(root,'nginx.conf'),quoted=value=>JSON.stringify(value);
 const proxy=target=>`proxy_pass http://127.0.0.1:${target}; proxy_http_version 1.1; proxy_set_header Host $http_host; proxy_set_header X-Real-IP $remote_addr; proxy_set_header X-Forwarded-Proto $scheme; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`;
 const content=`pid ${quoted(join(root,'nginx.pid'))}; error_log ${quoted(join(root,'error.log'))}; events {} http { access_log off; client_body_temp_path ${quoted(join(root,'body'))}; proxy_temp_path ${quoted(join(root,'proxy'))}; fastcgi_temp_path ${quoted(join(root,'fastcgi'))}; uwsgi_temp_path ${quoted(join(root,'uwsgi'))}; scgi_temp_path ${quoted(join(root,'scgi'))}; server { listen 127.0.0.1:${port}; server_name 127.0.0.1; root ${quoted(webRoot)}; location /.well-known/ { allow all; } location / { ${proxy(upstreamPort)} } ${maintenancePort?`location = /api/v1/public/maintenance { ${proxy(maintenancePort)} } location = /.well-known/qilicense-challenge { ${proxy(upstreamPort)} }`:''} } }\n`;
 await writeFile(config,content);const args=['-p',root+'/','-c',config];
 const checked=spawnSync('nginx',['-t',...args],{encoding:'utf8'});assert.equal(checked.status,0,checked.stderr);
 const child=spawn('nginx',[...args,'-g','daemon off;'],{stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',data=>errors+=data);
 const close=async()=>{if(child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');for(let i=0;i<100&&child.exitCode===null&&child.signalCode===null;i++)await delay(50);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');throw Error('NGINX_FIXTURE_STOP_TIMEOUT')}};
 try{for(let i=0;i<100;i++){assert.equal(child.exitCode,null,errors);try{await fetch(`http://127.0.0.1:${port}/`,{redirect:'manual',signal:AbortSignal.timeout(300)});return {close,verifyUnchanged:async()=>assert.equal(await readFile(config,'utf8'),content),mode:maintenancePort?'legacy-exact-routes':'default-static-and-proxy'}}catch{}await delay(50)}throw Error('NGINX_FIXTURE_START_TIMEOUT')}
 catch(error){await close();throw error}
}
