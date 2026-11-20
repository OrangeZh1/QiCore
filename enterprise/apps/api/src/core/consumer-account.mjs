// WeChat registration creates an opaque wx + 16 random-byte ID. It is not an
// OpenID or a customer-chosen login name; the separately stored binding proves
// its origin within this tenant/application, not the prefix alone.
export async function consumerAccountDisplay(db,{tenantId,applicationKey,userId}){
 const automatic=/^wx[a-f0-9]{32}$/.test(userId)&&!!await db.consumerExternalIdentity.findFirst({where:{tenantId,applicationKey,userId,provider:'wechat'},select:{userId:true}});
 return {account:automatic?null:userId,accountKind:automatic?'wechat':'account'};
}
