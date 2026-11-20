import test from 'node:test'
import assert from 'node:assert/strict'
import { passwordHash, passwordMatches, can } from '../src/identity.mjs'
test('密码校验及账号停用', async () => {
  const hash = await passwordHash('fixture-password-only')
  assert.equal(await passwordMatches('fixture-password-only',hash),true)
  assert.equal(await passwordMatches('other',hash),false)
  const account = {enabled:true,roleId:'member',role:{permissions:['hello.read']}}
  assert.equal(can(account,'hello.read'),true)
  assert.equal(can({...account,enabled:false},'hello.read'),false)
  assert.equal(can(account,'hello.write'),false)
})
