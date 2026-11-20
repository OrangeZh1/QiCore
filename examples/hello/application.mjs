import {defineApplication} from '@qicore/standalone/sdk'

export default defineApplication({
  key:'hello', title:'问候示例', permissions:['hello.read'],
  menus:[{path:'/apps/hello',title:'问候示例',permission:'hello.read'}],
  register({ route }) {
    route('get','/hello','hello.read', async ({account}) => ({message:'你好，'+account.displayName}))
  }
})
