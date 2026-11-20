import descriptor from './application.json' with {type:'json'};
export function createApplication(sdk){
 if(sdk?.version!==1)throw Error('APPLICATION_SDK_UNSUPPORTED');
 return {format:descriptor.format,version:descriptor.version,
  definition:{key:descriptor.key,name:descriptor.name,licensePackageKey:descriptor.packageKey,permissions:['status.read'],defaultConfig:()=>({}),validateConfig(value){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length)throw Error('PLUGIN_CONFIG_INVALID');return{}}},
  createRuntime({applicationKey}){return {key:descriptor.key,
   connect(){},initialize(){},tick(){},admin(){return{pluginKey:descriptor.key,applicationKey,ready:true}},
   consumer(){throw Error('PLUGIN_ROUTE_NOT_FOUND')},health(){return true},close(){}
  }}
 };
}
