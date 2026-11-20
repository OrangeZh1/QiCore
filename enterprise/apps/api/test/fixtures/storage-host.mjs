import assert from 'node:assert/strict'
import {join} from 'node:path'

export async function verifyStorageHost({base,uiBase,cookie,tenantCookie,enterpriseId,db,evidence}){
 const endpoint='/api/v1/admin/tenants/'+enterpriseId+'/storage'
 const read=(account,path=endpoint)=>fetch(base+path,{headers:{cookie:account,'x-console-portal':'tenant'}})
 const pageHtml=async account=>{
   const r=await fetch(uiBase+'/admin/storage',{headers:{cookie:account}})
   assert.equal(r.status,200);const html=await r.text()
   assert.equal(html.match(/<title>(.*?)<\/title>/)?.[1],'存储设置 · QiCore')
   assert.doesNotMatch(html,/启用此服务商|存储设置读取失败/)
   return html
 }
 const inherited=await read(tenantCookie);assert.equal(inherited.status,200)
 const first=(await inherited.json()).data
 assert.equal(first.siteId,enterpriseId);assert.equal(first.inherited,true);assert.deepEqual(first.providers,[]);assert.equal(first.canWrite,false)
 assert.match(await pageHtml(tenantCookie),/使用默认存储/);assert.equal((await read(cookie,endpoint.replace(enterpriseId,'other-enterprise'))).status,403)
 assert.equal((await fetch(uiBase+'/tenant/storage',{redirect:'manual'})).status,404)
 // Exercise the second real storage policy on the same enterprise, not a platform-wide API.
 await db.tenant.update({where:{id:enterpriseId},data:{storageMode:'tenant'}})
 try {
   const independent=await read(cookie);assert.equal(independent.status,200)
   const own=(await independent.json()).data
   assert.equal(own.siteId,enterpriseId);assert.equal(own.inherited,false);assert.equal(own.canWrite,true)
   assert.ok(own.providers.some(row=>row.provider==='local'))
   assert.equal((await (await read(tenantCookie)).json()).data.canWrite,false)
   assert.match(await pageHtml(cookie),/存储说明/)
   if(process.env.TEST_STORAGE_BROWSER==='1'){
     const {chromium}=await import('playwright')
     const browser=await chromium.launch({headless:process.env.QA_HEADED!=='1',channel:process.env.TEST_BROWSER_CHANNEL||'chromium',executablePath:process.env.QA_CHROMIUM})
     try{
       const context=await browser.newContext({viewport:{width:1440,height:1000}})
       const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:uiBase,httpOnly:true,sameSite:'Lax'}])
       const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
       await page.goto(uiBase+'/admin/storage');await page.getByRole('heading',{name:'存储设置',exact:true}).waitFor()
       await page.screenshot({path:join(evidence,'storage-enterprise.png'),fullPage:true})
       await page.getByRole('row').filter({hasText:'七牛 Kodo'}).getByRole('button',{name:'设置',exact:true}).click()
       const drawer=page.getByRole('dialog');await drawer.waitFor()
       await drawer.getByText('资源域名',{exact:true}).waitFor();assert.equal(await drawer.getByRole('switch').count(),0)
       await drawer.evaluate(async e=>{await Promise.all(e.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})))})
       const box=await drawer.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=1440)
       await page.screenshot({path:join(evidence,'storage-cloud-drawer.png'),fullPage:true})
       await page.keyboard.press('Escape')
       await db.tenant.update({where:{id:enterpriseId},data:{storageMode:'platform'}})
       await page.goto(uiBase+'/admin/workbench');const settings=page.getByRole('button',{name:'系统设置',exact:true})
       if(await settings.getAttribute('aria-expanded')!=='true')await settings.click()
       await page.locator('a[href="/admin/storage"]').click();await page.getByText('使用默认存储',{exact:true}).waitFor()
       assert.equal(await page.title(),'存储设置 · QiCore');await page.screenshot({path:join(evidence,'storage-enterprise-inherited.png'),fullPage:true})
       await page.reload();await page.getByText('使用默认存储',{exact:true}).waitFor();assert.deepEqual(errors,[])
     }finally{await browser.close()}
   }
 }finally{await db.tenant.update({where:{id:enterpriseId},data:{storageMode:'platform'}})}
}
