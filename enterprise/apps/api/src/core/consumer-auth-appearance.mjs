// Public display values only; shared by settings and both client rendering hosts.
export const consumerAuthAppearanceDefaults=()=>({image:null,brand:'',loginTitle:'欢迎回来',loginDescription:'登录账号，继续你的专属服务',registerTitle:'创建账号',registerDescription:'创建账号，开启你的专属服务'});
export function consumerAuthAppearance(value={}){const defaults=consumerAuthAppearanceDefaults();return Object.fromEntries(Object.entries(defaults).map(([key,fallback])=>[key,value?.[key]||fallback]));}
