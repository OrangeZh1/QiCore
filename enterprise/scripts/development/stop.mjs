import {readFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),state=process.argv[2]?resolve(process.argv[2]):join(root,'.local/development');
const run=JSON.parse(await readFile(join(state,'run.json'),'utf8'));if(run.stopped){console.log('Development workspace is already stopped.');process.exit(0)}
const origin='http://127.0.0.1:'+run.port,status=await(await fetch(origin+'/__qicore_dev/status')).json();if(status.workspaceId!==run.workspaceId)throw Error('Another process owns this port; no service was changed');
const response=await fetch(origin+'/__qicore_dev/stop',{method:'POST',headers:{'x-qicore-development-token':run.token}});if(!response.ok)throw Error('Development stop was rejected');console.log('Stopping this development workspace; data is retained.');
