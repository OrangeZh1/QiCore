import {isIP} from 'node:net'
export function forwardedClientIp(remote:string|undefined,header:string|undefined,trustedValue='127.0.0.1,::1,::ffff:127.0.0.1'){
 const trusted=trustedValue.split(',').map(v=>v.trim()).filter(Boolean)
 if(trusted.some(ip=>!isIP(ip)))throw new Error('TRUSTED_PROXY_IPS must contain exact IP addresses')
 let client=remote||''
 if(!isIP(client))return ''
 const chain=(header||'').split(',').map(v=>v.trim())
 if(chain.length>16||chain.some(ip=>!isIP(ip)))return client
 for(let i=chain.length-1;i>=0&&trusted.includes(client);i--)client=chain[i]!
 return client
}
