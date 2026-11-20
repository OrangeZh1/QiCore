// Test-only runtime preload. License activation is supplied separately to the controller's
// normal signed transport; product code can never send payments, messages or other external requests.
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
const local=input=>{const host=typeof input==='string'||input instanceof URL?new URL(input).hostname:input.hostname||input.host||'localhost';if(!['127.0.0.1','localhost','[::1]'].includes(host))throw Error('TEST_EXTERNAL_NETWORK_BLOCKED')};
const fetchOriginal=globalThis.fetch;globalThis.fetch=(input,options)=>{local(input?.url||input);return fetchOriginal(input,options)};
for(const module of [http,https])for(const name of ['request','get']){const original=module[name];module[name]=function(input,...args){local(input);return original.call(this,input,...args)}}
syncBuiltinESMExports();
