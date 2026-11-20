import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium}=createRequire(new URL('../../../package.json',import.meta.url))('playwright'),url=process.env.CLIENT_PREVIEW_URL||'http://127.0.0.1:3588/recharge',evidence=process.argv[2];assert.equal(new URL(url).hostname,'127.0.0.1');await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined}),checks=[];
try{
 for(const mode of ['delayed-get','unknown-order-post']){
  const page=await browser.newPage({viewport:{width:390,height:844}});let scene=mode==='delayed-get'?'updating':'ready',held,reads=0,writes=0,requestKey='',queried='';const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/**',async route=>{const path=new URL(route.request().url()).pathname;let data;
   if(path.endsWith('/public/maintenance'))data={protocol:'qicore-maintenance-v1',state:scene,serviceAvailable:scene==='ready',estimatedSeconds:null,startedAt:new Date().toISOString()};
   else if(path.endsWith('/wallet')){reads++;if(mode==='delayed-get'&&reads===1){held=route;return}data={points:{amount:10,version:1,unit:'POINT'},balance:{amount:1234,version:1,unit:'CNY_CENT'}};}
   else if(path.endsWith('/recharge/catalog'))data={version:1,points:[],balance:{tiers:[],customEnabled:true,minCents:1,maxCents:1000000}};
   else if(route.request().method()==='POST'&&path.endsWith('/recharge/orders')){writes++;requestKey=route.request().postDataJSON().requestKey;held=route;return}
   else if(path.includes('/recharge/orders/by-request/')){queried=decodeURIComponent(path.split('/').at(-1));data={id:'original-order',status:'pending'}}
   else{await route.continue();return}await route.fulfill({json:{data}});
  });
  await page.goto(url);const panel=page.locator('.client-dialog-panel'),input=page.locator('input').first();
  if(mode==='unknown-order-post'){
   await input.fill('12.34');await page.getByRole('button',{name:'确认充值',exact:true}).click();for(let i=0;i<30&&!held;i++)await page.waitForTimeout(50);assert.ok(held);
   scene='updating';await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'))});
  }
  await panel.waitFor();scene='ready';await page.getByRole('button',{name:'检查恢复状态',exact:true}).click();await panel.waitFor({state:'hidden'});assert.ok(held);assert.equal(reads,1,'recovery must wait for the original request');await held.abort('failed');
  if(mode==='delayed-get'){await input.waitFor();assert.equal(reads,2);assert.equal(writes,0);assert.equal(await page.getByText('账户数据暂不可用，请重试',{exact:true}).count(),0)}
  else{await page.getByText('已有充值订单，可继续查看或支付',{exact:true}).waitFor();assert.equal(writes,1);assert.equal(queried,requestKey);assert.equal(await input.inputValue(),'12.34');assert.equal(new URL(page.url()).pathname,'/recharge');assert.equal(reads,2)}
  await page.waitForTimeout(200);assert.equal(reads,2);assert.deepEqual(errors,[]);await page.screenshot({path:join(evidence,'client-overlap-'+mode+'.png'),fullPage:true});checks.push({mode,reads,writes,originalOrderQueried:mode==='unknown-order-post',inputCheckApplicable:mode==='unknown-order-post',inputRetained:mode==='unknown-order-post'?true:null,noAutomaticWriteReplay:true});await page.close();
 }
 await writeFile(join(evidence,'client-overlap-check.json'),JSON.stringify({at:new Date().toISOString(),url,realH5Build:true,isolatedBrowserResponses:true,checks},null,2));console.log(JSON.stringify(checks));
}finally{await browser.close()}
