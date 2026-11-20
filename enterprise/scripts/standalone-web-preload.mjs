import {bindWebComponents} from '../apps/api/dist/applications/standalone-web-inventory.mjs'
import {verifiedBundle} from '../apps/api/dist/applications/standalone-bundle.js'

// Preload in the Nuxt renderer process only. The API verifies its own release
// and never treats a web renderer's catalog as proof of package authenticity.
if(process.env.NODE_ENV!=='production'||process.env.QICORE_DEV_WORKSPACE||process.env.QICORE_COMPONENTS)throw Error('STANDALONE_WEB_ENVIRONMENT_INVALID')
const {QICORE_STANDALONE_BUNDLE_ROOT:root,QICORE_STANDALONE_RELEASE_FILE:release,QICORE_STANDALONE_PRODUCT_FILE:product}=process.env
if(root||release||product){
  if(!root||!release||!product)throw Error('STANDALONE_VERIFIED_PRODUCT_BUNDLE_REQUIRED')
  const verified=await verifiedBundle(root,release,product)
  bindWebComponents(verified.components)
  process.env.QICORE_COMPONENTS=JSON.stringify(verified.components)
}else{
  bindWebComponents({})
  process.env.QICORE_COMPONENTS='{}'
}
