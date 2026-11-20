let allowed=()=>false;
export function bindPluginAccess(policy){if(typeof policy!=='function')throw Error('PLUGIN_POLICY_INVALID');allowed=policy}
export const pluginAllowed=packageKey=>allowed(packageKey)===true;
