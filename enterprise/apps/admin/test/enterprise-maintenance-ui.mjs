import assert from 'node:assert/strict'

/** Read-only UI permission checks for either an owner or a deliberately limited enterprise role. */
export async function verifyMaintenanceSurfacePermissions(page, origin) {
  const response=await page.context().request.get(origin+'/api/v1/admin/auth/me',{headers:{'X-Console-Portal':'tenant'}})
  assert.equal(response.status(),200)
  const session=(await response.json()).data
  const scope=session.tenantId||session.tenantIds?.[0]
  const effective=await page.context().request.get(origin+'/api/v1/admin/tenant-entry?tenantId='+encodeURIComponent(scope),{headers:{'X-Console-Portal':'tenant'}})
  assert.equal(effective.status(),200)
  const grants=new Set((await effective.json()).data.permissions||session.permissionsByTenant?.[scope]||session.permissions||[])
  const pages=[
    ['system-logs','tenant:audit.read',[['导出','tenant:audit.export']]],
    ['environment','tenant:environment.read',[['检测','tenant:environment.check']]],
    ['scheduled-tasks','tenant:tasks.read',[['新增','tenant:tasks.write'],['编辑','tenant:tasks.write'],['启用','tenant:tasks.write'],['停用','tenant:tasks.write'],['立即执行','tenant:tasks.execute'],['删除','tenant:tasks.delete']]],
    ['system-cache','tenant:cache.read',[['清除系统缓存','tenant:cache.clear']]],
    ['data-security','tenant:backups.read',[['新建备份','tenant:backups.create'],['校验','tenant:backups.verify'],['下载','tenant:backups.download'],['还原','tenant:backups.restore'],['删除','tenant:backups.delete'],['批量删除','tenant:backups.delete']]],
  ]
  const results=[]
  for(const [slug,read,actions] of pages){
    const path='/admin/'+slug
    const doc=await page.goto(origin+path,{waitUntil:'domcontentloaded'})
    if(!grants.has(read)){
      assert.equal(doc.status(),403,'无读取权限不能打开 '+path)
      results.push({path,status:403,read:false})
      continue
    }
    assert.equal(doc.status(),200,'可读取 '+path)
    await page.getByRole('button',{name:/切换(深|浅)色模式/}).waitFor()
    const stage=page.locator('.qisvc-console-stage')
    for(const [label,permission] of actions){
      if(grants.has(permission))continue
      const pattern=label==='批量删除'?/^批量删除/:label==='检测'?/^(立即检测|重新检测|检测|检查)$/:label
      const options={name:pattern,exact:typeof pattern==='string'}
      assert.equal(await stage.getByRole('button',options).filter({visible:true}).count(),0,'无 '+permission+' 权限的按钮 '+label)
      assert.equal(await stage.getByRole('link',options).filter({visible:true}).count(),0,'无 '+permission+' 权限的入口 '+label)
    }
    results.push({path,status:200,read:true})
  }
  return results
}
