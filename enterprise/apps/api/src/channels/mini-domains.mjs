import {isIP} from 'node:net';
export function miniProgramDomains(value=process.env.PUBLIC_API_ORIGIN||process.env.ADMIN_ORIGIN,webOrigin=process.env.PUBLIC_WEB_ORIGIN||process.env.ADMIN_ORIGIN||value){
 const empty={available:false,request:'',uploadFile:'',downloadFile:'',socket:'',udp:'',business:'',message:'请配置服务端公网 HTTPS 接口地址'};
 try{const url=new URL(value),host=url.hostname.toLowerCase();if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')return empty;
  const available=url.protocol==='https:'&&!url.port&&!isIP(host.replace(/^\[|\]$/g,''))&&host.includes('.')&&host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))&&!/(^|\.)(localhost|local|internal|test|invalid|example|lan|home|arpa)$/.test(host);
  let business=url.host;if(webOrigin){try{const web=new URL(webOrigin);business=['http:','https:'].includes(web.protocol)&&!web.username&&!web.password&&!web.search&&!web.hash&&web.pathname==='/'?web.host:''}catch{business=''}}
  return{available,request:url.origin,uploadFile:url.origin,downloadFile:url.origin,socket:(url.protocol==='https:'?'wss://':'ws://')+url.host,udp:'udp://'+url.host,business,message:available?'将这些域名配置到微信公众平台；对象存储域名按实际文件来源补充。':'当前为开发地址，真实预览和上传需要公网 HTTPS 接口地址。'};
 }catch{return empty}
}
