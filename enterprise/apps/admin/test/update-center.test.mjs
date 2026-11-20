import {test} from 'node:test';
import assert from 'node:assert/strict';
import {releaseNoteLines,releasePresentation,expiry,dateTime,applicationTenantQuota} from '../app/utils/update-center.ts';
import {updateStepIndex,updateNotice} from '../app/utils/update-center.ts';
import {updatePreview,previewScenes} from '../app/utils/update-preview.ts';

test('release notes preserve user text and parse tags without rendering HTML',()=>{
  assert.deepEqual(releaseNoteLines('# 新增：菜单\n- 修复：对齐\n小程序更新：需要客户自行上传\n强制更新：是\n<script>alert(1)</script>'),[{tag:'',text:'新增：菜单',heading:true},{tag:'修复',text:'对齐'},{tag:'',text:'<script>alert(1)</script>'}]);
  assert.deepEqual(releaseNoteLines(''),[]);
});
test('mini-program notices are scoped to applications even in old framework task snapshots',()=>{
 const old={version:'0.1.0',releaseNotes:'修复：首装\n小程序更新：需要客户自行上传',miniProgramUpdateRequired:true};
 assert.equal(releasePresentation(old,'framework').miniProgramUpdateRequired,false);
 assert.equal(releasePresentation(old,'application').miniProgramUpdateRequired,true);
 assert.equal(releasePresentation({...old,miniProgramUpdateRequired:undefined},'application').miniProgramUpdateRequired,true);
 assert.equal(releasePresentation({releaseNotes:'修复：服务端更新'},'application').miniProgramUpdateRequired,undefined);
 assert.equal(old.miniProgramUpdateRequired,true,'presentation must preserve immutable task evidence');
});
test('unknown expiry never appears perpetual, while verified null expiry does',()=>{
  assert.equal(expiry(null,false),'待获取');assert.equal(expiry(null,true),'长期有效');
  assert.ok(expiry('2027-10-08T07:18:00.000Z',true).includes('2027/10/08'));
});

test('tenant quota copy distinguishes occupied, exhausted, unlimited and unknown states',()=>{
 const q=(limit,used,known=true,usageKnown=true)=>applicationTenantQuota({tenantLimit:limit,tenantLimitKnown:known,tenantUsed:used,tenantUsageKnown:usageKnown});
 assert.deepEqual(q(5,2),{total:'5 个',used:'2 个',remaining:'3 个',summary:'已用 2 / 5'});
 assert.equal(q(0,0).remaining,'0 个');assert.equal(q(5,7).remaining,'0 个');
 assert.equal(q(null,2).remaining,'不限');assert.equal(q(undefined,2,false).total,'待获取');
 assert.equal(q(5,null,true,false).remaining,'待获取');assert.equal(q(5,null,true,false).used,'待获取');
});
test('preview outcomes distinguish failures from completed installation history',()=>{
  for(const scene of previewScenes){const data=updatePreview(scene.value);assert.equal(data.installer.canInstall,scene.value==='available');assert.equal(data.history.total,scene.value==='succeeded'?1:scene.value==='history'?3:0);if(data.tasks[0])assert.ok(updateNotice(data.tasks[0]).description)}
  const history=updatePreview('history');assert.equal(history.tasks.length,0);assert.equal(history.history.items.filter(item=>item.version===history.update.currentVersion).length,1);
  assert.equal(updateStepIndex('MIGRATE'),2);assert.equal(updateStepIndex('HEALTH'),3);
  assert.equal(updateNotice(updatePreview('closeout').tasks[0]).title,'新版本已生效，等待完成收尾');
  assert.equal(updateNotice(updatePreview('recovery_required').tasks[0]).color,'error');
});

test('framework preview updates do not imply an application or mini-program upgrade',()=>{
 const before=updatePreview(),after=updatePreview('succeeded');
 assert.notEqual(before.update.currentVersion,after.update.currentVersion);
 assert.deepEqual(before.applications.installed,after.applications.installed);
 assert.equal(after.update.miniProgramUpdateRequired,false);
 assert.ok(!after.update.releaseNotes.includes('小程序更新'));
});

test('many-app preview supplies distinct rows without inventing update tasks',()=>{
 const data=updatePreview('many_apps');assert.equal(data.tasks.length,0);assert.equal(data.installer.canInstall,false);
 assert.equal(data.applications.installed.length,26);assert.equal(data.applications.purchased.length,8);
 assert.equal(new Set([...data.applications.installed,...data.applications.purchased].map(app=>app.packageKey)).size,34);
});

test('incomplete application packages explain how to resolve the blocked installation',()=>{
 const notice=updateNotice({id:'layout',operation:'install',status:'blocked',step:'PULL',code:'APPLICATION_LAYOUT_INCOMPLETE',version:'1.0.0',fromVersion:null,updatedAt:''});
 assert.equal(notice.title,'安装未开始');assert.match(notice.description,/缺少必需文件/);assert.match(notice.description,/当前运行版本没有切换/);
});

test('a scoped dependency rejection explains the required application update without calling it a network failure',()=>{
 const notice=updateNotice({id:'dependency',operation:'update',status:'blocked',step:'AUTHORIZE',code:'SCOPED_UPDATE_DEPENDENCY_CONFLICT',version:null,fromVersion:'0.1.0',updatedAt:''});
 assert.equal(notice.title,'更新未开始');assert.match(notice.description,/先更新相关应用到兼容版本/);assert.match(notice.description,/当前运行版本没有切换/);assert.doesNotMatch(notice.description,/网络/);
});

test('shared console timestamps retain seconds in Shanghai including midnight and empty values',()=>{
 assert.equal(dateTime('2026-10-10T10:24:37.999Z'),'2026/10/10 18:24:37');
 assert.equal(dateTime('2026-10-10T16:00:05.000Z'),'2026/10/11 00:00:05');
 assert.equal(dateTime(null),'—');assert.equal(dateTime(undefined),'—');
});
