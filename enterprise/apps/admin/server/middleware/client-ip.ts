import {forwardedClientIp} from '../utils/client-ip'
export default defineEventHandler(event=>{
 if(!event.path.startsWith('/api/v1/'))return
 const headers=event.node.req.headers
 const value=headers['x-forwarded-for']
 const client=forwardedClientIp(event.node.req.socket.remoteAddress,typeof value==='string'?value:undefined,process.env.TRUSTED_PROXY_IPS)
 // Replace client-supplied chains before the loopback API proxy consumes them.
 delete headers.forwarded;delete headers['x-real-ip']
 if(client)headers['x-forwarded-for']=client;else delete headers['x-forwarded-for']
})
