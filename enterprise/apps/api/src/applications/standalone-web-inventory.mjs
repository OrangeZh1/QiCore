// Both the host preload and Nitro's compiled SSR code run in this Node process.
// Cross-bundle identity lives on the process, independent of bundled module copies.
const marker = Symbol.for('qicore.standalone.verified.web-components.v1')

export function bindWebComponents(inventory) {
  if (process[marker]) throw Error('WEB_COMPONENTS_ALREADY_BOUND')
  const components = Object.freeze(Object.fromEntries(Object.entries(inventory).map(([key,value])=>[key,Object.freeze({...value})])))
  Object.defineProperty(process,marker,{value:components,configurable:false,writable:false})
}

export function standaloneWebComponents(env=process.env) {
  const verified=process[marker]
  if (verified) return verified
  if(env.QICORE_COMPONENTS||env.QICORE_STANDALONE_BUNDLE_ROOT||env.QICORE_STANDALONE_RELEASE_FILE||env.QICORE_STANDALONE_PRODUCT_FILE)throw Error('VERIFIED_WEB_COMPONENT_PRELOAD_REQUIRED')
  return {}
}
