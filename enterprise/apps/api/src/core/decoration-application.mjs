import {application} from '../applications/registry.mjs';

// Public presentation data only. The caller must first verify the tenant's application binding.
export async function applicationDecorationContent(db,identity){
 const adapter=application(identity.applicationKey).decoration;
 return adapter?.publicContent?await adapter.publicContent(db,{tenantId:identity.tenantId,applicationKey:identity.applicationKey}):{components:[],targets:[]};
}
