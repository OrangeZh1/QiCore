// Read-only operator preflight. Configuration application and restart remain deployment steps.
import {readFileSync,lstatSync,existsSync} from 'node:fs';
import {resolve,dirname,join,isAbsolute,relative,sep} from 'node:path';
import {bootstrapConfigSchema} from '../apps/api/dist/lifecycle/bootstrap-config.js';
import {nativeConfigSchema} from '../apps/api/dist/lifecycle/native-state.js';
import {canonicalJson} from '../apps/api/dist/license/contracts.js';
import {noLinks} from '../apps/api/dist/lifecycle/native-files.js';
const [configuration,controller]=process.argv.slice(2);
if(!configuration||!controller||![configuration,controller].every(isAbsolute))throw Error('Usage: node scripts/check-maintenance-bootstrap.mjs <bootstrap.json> <new-controller.mjs>');
for(const path of [configuration,controller]){noLinks(path);if(!lstatSync(path).isFile())throw Error('REGULAR_FILE_REQUIRED')}
const bootstrap=bootstrapConfigSchema.parse(JSON.parse(readFileSync(configuration,'utf8')));
const saved=nativeConfigSchema.parse(JSON.parse(readFileSync(bootstrap.nativeConfigFile,'utf8')));
if(canonicalJson({...saved,migrationUrl:''})!==canonicalJson({...bootstrap.native,migrationUrl:''}))throw Error('INSTALL_CONFIG_CHANGED');
if(!readFileSync(controller,'utf8').includes('qicore-maintenance-v1'))throw Error('MAINTENANCE_CONTROLLER_UPGRADE_REQUIRED');
const controllerRelative=relative(resolve(bootstrap.native.root),resolve(controller));
if(!controllerRelative||controllerRelative!=='..'&&!controllerRelative.startsWith('..'+sep)&&!isAbsolute(controllerRelative))throw Error('BOOTSTRAP_INSIDE_VERSION_ROOT');
if(existsSync(join(bootstrap.native.dataRoot,'control','maintenance.json')))throw Error('PENDING_RECOVERY_REQUIRES_OPERATOR');
const port=bootstrap.native.maintenancePort??3502;
if([new URL(saved.healthUrl).port,new URL(saved.loginUrl).port].includes(String(port)))throw Error('MAINTENANCE_PORT_CONFLICT');
console.log(JSON.stringify({check:'passed',writes:false,controllerOutsideVersions:true,maintenancePort:port,configuration:resolve(configuration),nativeConfiguration:bootstrap.nativeConfigFile,requiredSteps:['核验新 bootstrap 正式校验材料与运行依赖','停止面板 Node 项目并确认控制器锁已释放','通过现有恢复记录保存两个私有配置的原值，同步增加 maintenancePort','安装已核验的稳定控制器与配套 worker','核对端口占用；把维护路径独立映射到控制器','面板启动后验证公开状态和业务健康','保留升级回执；按 current-only 清理旧受控代码']},null,2));
