/** @returns {import('./decoration-types.ts').CustomerServiceConfig} */
export const customerServiceDefaults=()=>({miniMode:'page',phone:'',wechat:'',description:'',avatar:null,qrCode:null});
export function customerServiceOpenType(target,config,platform){
 const contact=target==='system:contact'||target?.type==='url'&&target.url==='/pages/contact/index';
 return contact&&platform==='mp-weixin'&&config?.miniMode==='official'?'contact':undefined;
}
