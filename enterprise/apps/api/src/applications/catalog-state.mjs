// Filled once during trusted startup, before routes, resources or workers start.
// Keeping this state separate lets an application borrow host services without
// importing the loader again while its own module is being evaluated.
export const applications=new Map();
export let frameworkApplication;
export function setApplicationDefinitions(definitions){
 if(applications.size)throw Error('APPLICATION_CATALOG_ALREADY_INITIALIZED');
 for(const definition of definitions)if(definition.key==='system')frameworkApplication=definition;else applications.set(definition.key,definition);
}
