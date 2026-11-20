import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {filterConsoleItems,markConsoleItems,activeConsoleGroups,consoleBreadcrumbs,canAccessConsolePath,platformLanding} from '../app/utils/console-navigation.ts';
import {platformConsole} from '../app/config/console.ts';
import {canViewTenantOverview} from '../app/utils/tenant-entry.ts';
test('tenant overview follows loaded application availability instead of a fixed app key',()=>{
 assert.equal(canViewTenantOverview(['overview.read'],false),false);assert.equal(canViewTenantOverview(['id-photo:overview.read'],false),false);
 assert.equal(canViewTenantOverview(['another-app:overview.read'],true),true);assert.equal(canViewTenantOverview(['tenant:overview.read'],true),false);assert.equal(canViewTenantOverview([],true),false);
});
const groups=[{key:'tenants',label:'租户管理',icon:'',items:[{label:'租户列表',icon:'',to:'/admin/tenants'},{label:'SaaS用户',icon:'',to:'/admin/saas-users'}]},{key:'system',label:'系统设置',icon:'',items:[{label:'存储设置',icon:'',to:'/admin/storage'}]}];
test('dynamic platform and tenant menu icons are included in the offline client bundle',async()=>{
 const config=await readFile(new URL('../nuxt.config.ts',import.meta.url),'utf8'),tenant=await readFile(new URL('../app/components/tenant/TenantConsoleShell.vue',import.meta.url),'utf8');
 const bundled=new Set([...config.matchAll(/'lucide:([a-z0-9-]+)'/g)].map(match=>match[1]));
 for(const match of (JSON.stringify(platformConsole)+tenant).matchAll(/i-lucide-([a-z0-9-]+)/g))assert.ok(bundled.has(match[1]),'Missing menu icon: '+match[1]);
});
test('material library is a standalone scoped item between tenants and permissions',()=>{
  assert.deepEqual(platformConsole.groups.map(g=>g.key),['tenants','materials','permissions','system']);
  assert.equal(platformConsole.groups.find(g=>g.key==='materials').to,'/admin/materials');
  assert.equal(canAccessConsolePath('/admin/materials',{permissions:['materials.read']}),true);
  assert.equal(canAccessConsolePath('/admin/materials',{permissions:['accounts.read']}),false);
  assert.deepEqual(consoleBreadcrumbs(platformConsole.groups,'/admin/materials'),[{label:'素材管理'}]);
});
test('cache and task editor use maintenance navigation, registered icons and scoped permissions',()=>{
  assert.equal(canAccessConsolePath('/admin/system-cache',{permissions:['cache.read']}),true);
  assert.equal(canAccessConsolePath('/admin/scheduled-tasks/new',{permissions:['tasks.read']}),true);
  assert.equal(canAccessConsolePath('/admin/scheduled-tasks',{permissions:['settings.read']}),false);
  assert.deepEqual(activeConsoleGroups(platformConsole.groups,'/admin/scheduled-tasks/new'),['system','maintenance']);
  assert.equal(consoleBreadcrumbs(platformConsole.groups,'/admin/scheduled-tasks/new').at(-1).label,'新增定时任务');
  assert.equal(markConsoleItems(platformConsole.groups.find(g=>g.key==='system').items,'/admin/scheduled-tasks/new')[2].children[0].active,true);
  assert.equal(platformConsole.groups.find(g=>g.key==='system').items[2].children[0].icon,'i-lucide-clock-3');
});
test('system environment follows the approved maintenance hierarchy and service permission',()=>{
  assert.deepEqual(activeConsoleGroups(platformConsole.groups,'/admin/environment'),['system','maintenance']);
  assert.deepEqual(consoleBreadcrumbs(platformConsole.groups,'/admin/environment'),[{label:'系统设置'},{label:'系统维护'},{label:'系统环境'}]);
  assert.equal(canAccessConsolePath('/admin/environment',{permissions:['services.read']}),true);
  assert.equal(canAccessConsolePath('/admin/environment',{permissions:['roles.read']}),false);
});
test('restricted platform accounts land on an allowed page',()=>{
  assert.equal(platformLanding({permissions:['overview.read']}),'/admin');
  assert.equal(platformLanding({permissions:['roles.read']}),'/admin/roles');
  assert.equal(platformLanding({permissions:['settings.read']}),'/admin/site');
  assert.equal(platformLanding({permissions:[]}),'/admin/profile');
  assert.equal(platformLanding({permissions:['audit.read']}),'/admin/system-logs');
  assert.equal(canAccessConsolePath('/admin/administrators',{permissions:['accounts.read']}),true);
  assert.equal(canAccessConsolePath('/admin/administrators',{permissions:['roles.read']}),false);
});
test('system logs sit inside system maintenance and both ancestors reveal on refresh',()=>{
  const menu=[{key:'system',label:'系统设置',icon:'',items:[{key:'maintenance',label:'系统维护',icon:'',children:[{label:'系统日志',icon:'',to:'/admin/system-logs'}]}]}];
  assert.deepEqual(activeConsoleGroups(menu,'/admin/system-logs'),['system','maintenance']);
  assert.deepEqual(consoleBreadcrumbs(menu,'/admin/system-logs'),[{label:'系统设置'},{label:'系统维护'},{label:'系统日志'}]);
  assert.equal(filterConsoleItems(menu[0].items,{permissions:[]}).length,0);
  assert.equal(filterConsoleItems(menu[0].items,{permissions:['audit.read']}).length,1);
});
test('campus navigation filters grants and marks only the active leaf',()=>{
  assert.deepEqual(filterConsoleItems(groups[0].items,{permissions:['accounts.read']}).map(i=>i.label),['SaaS用户']);
  assert.equal(canAccessConsolePath('/admin/unknown',{permissions:['accounts.read']}),false);
  const items=markConsoleItems(groups[0].items,'/admin/tenants/');assert.equal(items[0].active,true);assert.equal(items[1].active,false);
});
test('current route reveals only its own ancestors and derives breadcrumbs',()=>{
  assert.deepEqual(activeConsoleGroups(groups,'/admin/storage'),['system']);
  assert.deepEqual(activeConsoleGroups(groups,'/admin'),[]);
  assert.deepEqual(consoleBreadcrumbs(groups,'/admin/storage'),[{label:'系统设置'},{label:'存储设置'}]);
});
