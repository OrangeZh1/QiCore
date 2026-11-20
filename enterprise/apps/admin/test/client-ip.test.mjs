import {test} from 'node:test';
import assert from 'node:assert/strict';
import {forwardedClientIp} from '../server/utils/client-ip.ts';
test('proxy client IP ignores spoofed headers and walks only explicitly trusted hops',()=>{
 assert.equal(forwardedClientIp('198.51.100.10','1.2.3.4'),'198.51.100.10');
 assert.equal(forwardedClientIp('127.0.0.1','1.2.3.4, 198.51.100.10'),'198.51.100.10');
 assert.equal(forwardedClientIp('172.18.0.1','203.0.113.9','172.18.0.1'),'203.0.113.9');
 assert.equal(forwardedClientIp('172.18.0.1','203.0.113.9',''),'172.18.0.1');
 assert.equal(forwardedClientIp('127.0.0.1','invalid'),'127.0.0.1');
 assert.throws(()=>forwardedClientIp('127.0.0.1','1.2.3.4','*'));
});
