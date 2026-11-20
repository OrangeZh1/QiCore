import {decorationTheme} from './decoration-contract.mjs';
import {application} from '../applications/registry.mjs';

// Only the saved, effective decoration may change public client colours.
export async function consumerTheme(db,tenantId,applicationKey){
 const row=await db.tenantDecoration.findUnique({where:{tenantId_applicationKey:{tenantId,applicationKey}}});
 return decorationTheme(row?.published||application(applicationKey).decoration?.defaults()||{});
}
