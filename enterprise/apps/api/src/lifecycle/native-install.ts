import {pathToFileURL} from 'node:url'

// This upstream command installs a framework-licensed SaaS component. The
// enterprise edition provisions an unlicensed host or a signed whole product.
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  console.error('STANDALONE_INSTALLER_REQUIRED')
  process.exitCode=1
}
