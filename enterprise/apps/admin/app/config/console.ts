import type {ConsoleMenuGroup,ConsoleMenuItem} from '../utils/console-navigation'
export const platformConsole:{home:string;links:readonly ConsoleMenuItem[];groups:readonly ConsoleMenuGroup[]}={
  home:'/admin',
  links:[{label:'工作台',icon:'i-lucide-layout-dashboard',to:'/admin'},{label:'框架与应用',icon:'i-lucide-layers',to:'/admin/updates'}],
  groups:[
    {key:'tenants',label:'租户管理',icon:'i-lucide-building-2',items:[{label:'租户列表',icon:'i-lucide-building-2',to:'/admin/tenants'},{label:'SaaS用户',icon:'i-lucide-users',to:'/admin/saas-users'}]},
    {key:'materials',label:'素材管理',icon:'i-lucide-images',to:'/admin/materials',items:[{label:'素材管理',icon:'i-lucide-images',to:'/admin/materials'}]},
    {key:'permissions',label:'权限管理',icon:'i-lucide-shield-check',items:[{label:'角色',icon:'i-lucide-shield-check',to:'/admin/roles'},{label:'管理员',icon:'i-lucide-users',to:'/admin/administrators'}]},
    {key:'system',label:'系统设置',icon:'i-lucide-settings',items:[{label:'网站设置',icon:'i-lucide-monitor',to:'/admin/site'},{label:'存储设置',icon:'i-lucide-database',to:'/admin/storage'},{key:'maintenance',label:'系统维护',icon:'i-lucide-settings',children:[{label:'定时任务',icon:'i-lucide-clock-3',to:'/admin/scheduled-tasks'},{label:'系统日志',icon:'i-lucide-history',to:'/admin/system-logs'},{label:'数据安全',icon:'i-lucide-shield-check',to:'/admin/data-security'},{label:'系统缓存',icon:'i-lucide-database',to:'/admin/system-cache'},{label:'系统环境',icon:'i-lucide-server',to:'/admin/environment'}]}]},
  ],
}
