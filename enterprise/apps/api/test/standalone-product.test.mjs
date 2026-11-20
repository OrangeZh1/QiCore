import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LicenseRuntime } from '../dist/license/runtime.js'

test('纯框架提供企业公共功能，未装商业组件不产生授权和远端检查', async () => {
  const runtime = LicenseRuntime.forStandalone('0.1.10', [])
  assert.equal(runtime.licensedClient, null)
  assert.equal(runtime.frameworkVersion, '0.1.10')
  const view = await runtime.check(true)
  assert.equal(view.allowed, true)
  assert.equal(view.license.verified, false)
  assert.equal(view.canCheck, false)
  assert.equal(view.automatic.enabled, false)
  assert.equal(runtime.componentAllowed('app_example', 'app'), false)
  assert.equal(runtime.componentAllowed('plugin_example', 'plugin'), false)
  assert.throws(() => runtime.assertComponentAllowed('plugin_example','plugin'), /组件未包含/)
  runtime.start()
  runtime.stop()
})

test('商业主应用必须与整包的受信公开产品配置匹配', () => {
  const main = { packageKey: 'app_example', version: '1.0.0', componentType: 'app' }
  assert.throws(() => LicenseRuntime.forStandalone('0.1.10', [main]), /STANDALONE_TRUSTED_APP_PRODUCT_REQUIRED/)
  assert.throws(() => LicenseRuntime.forStandalone('0.1.10', [main, {...main,packageKey:'app_other'}]), /STANDALONE_COMPOSITION_INVALID/)
  assert.throws(() => LicenseRuntime.forStandalone('0.1.10', [{...main,componentType:'plugin'}]), /STANDALONE_COMPOSITION_INVALID/)
})
