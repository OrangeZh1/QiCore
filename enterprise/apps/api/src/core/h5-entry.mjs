import {createHash} from 'node:crypto';
import {isIP} from 'node:net';

export function h5Origin(){
 const url=new URL(process.env.PUBLIC_ADMIN_ORIGIN||process.env.ADMIN_ORIGIN||'http://127.0.0.1:3500');
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Invalid public origin');
 return url;
}
export function h5Domain(value){
 if(!value)return '';
 const raw=String(value).trim().toLowerCase();
 if(raw.includes('/')||raw.includes(':')||raw.includes('@'))throw Error('请只填写域名，不含协议、端口或路径');
 const hostname=new URL('https://'+raw).hostname;
 if(isIP(hostname)||hostname.length>253||!hostname.includes('.')||!hostname.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))throw Error('请填写有效的独立域名');
 return hostname;
}
export function savedH5Domain(entryUrl){try{return h5Domain(new URL(entryUrl).hostname)}catch{return ''}}
export function h5DomainProof(tenantId,key,domain){return 'qicore-h5='+createHash('sha256').update([tenantId,key,domain].join('\n')).digest('hex')}
export function h5EntryUrl(tenantId,origin=h5Origin().origin){return origin+'/h5/'+encodeURIComponent(tenantId)+'/'}
export function h5Host(value){try{const raw=String(value||'');if(/[\s/@\\?#]/.test(raw))throw Error();return new URL('http://'+raw).host.toLowerCase()}catch{throw Error('访问域名无效')}}
export function isH5PlatformHost(value){const host=h5Host(value),base=h5Origin();return host===base.host||process.env.NODE_ENV!=='production'&&['127.0.0.1','localhost','[::1]'].includes(new URL('http://'+host).hostname)&&new URL('http://'+host).port===base.port}
