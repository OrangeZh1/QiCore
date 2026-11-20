// Presentation mapping only. Runtime authorization uses verified QiLicense receipts.
export function licenseFailureNotice(reason){
  if(['LICENSE_EXPIRED','ENTITLEMENT_EXPIRED'].includes(reason))return {state:'expired',label:'授权到期',description:'当前授权已到期，请联系平台管理员续期后重新校验。'};
  if(['LICENSE_SUSPENDED','LICENSE_REVOKED','ENTITLEMENT_SUSPENDED','ENTITLEMENT_REVOKED','INSTANCE_REVOKED','COMPONENT_DISABLED'].includes(reason))return {state:'suspended',label:'授权封禁',description:'当前授权已被封禁或停用，请联系平台管理员核实处理。'};
  if(['NO_RECEIPT','PRODUCT_AUTHORIZATION_NOT_FOUND','PRODUCT_NOT_ENTITLED','LICENSE_DELETED','INSTANCE_PENDING'].includes(reason))return {state:'unlicensed',label:'未授权',description:'当前部署尚未获得使用授权，请联系平台管理员完成授权。'};
  return {state:'unavailable',label:'授权校验失败',description:'暂时无法确认授权状态，请重新校验或联系平台管理员。'};
}
