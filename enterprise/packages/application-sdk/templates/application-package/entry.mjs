import descriptor from './application.json' with {type:'json'};

// Minimal server-only package example. Add business adapters in the application,
// and borrow host resources; never initialize another framework or close its DB.
export function createApplication(sdk){
 if(sdk?.version!==1)throw Error('APPLICATION_SDK_UNSUPPORTED');
 return{
  format:descriptor.format,
  version:descriptor.version,
  definition:{
   key:descriptor.key,
   name:descriptor.name,
   licensePackageKey:descriptor.packageKey,
   permissions:[],
   defaultConfig:()=>({}),
   validateConfig(value){
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length)throw Error('APPLICATION_CONFIG_INVALID');
    return{};
   }
  },
  createRuntime(){
   return{
    key:descriptor.key,
    consumerPaths:[],
    connect(){},
    initialize(){},
    tick(){},
    admin(){throw Error('APPLICATION_ROUTE_NOT_FOUND')},
    consumer(){throw Error('APPLICATION_ROUTE_NOT_FOUND')},
    health(){return true},
    close(){}
   };
  }
 };
}
