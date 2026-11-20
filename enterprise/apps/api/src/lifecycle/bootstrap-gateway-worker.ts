import {isAbsolute} from 'node:path';
import {createBootstrapGateway,type GatewaySettings} from './bootstrap-gateway.js';

if(process.platform!=='linux'||!process.send||!process.getuid?.())throw Error('UNPRIVILEGED_GATEWAY_REQUIRED');
const settings=JSON.parse(process.argv[2]??'null') as GatewaySettings;
const port=(value:number)=>Number.isInteger(value)&&value>=1024&&value<=65535;
if(!settings||!port(settings.publicPort)||!port(settings.uiPort)||!settings.maintenance
 ||('socketPath' in settings.maintenance?!isAbsolute(settings.maintenance.socketPath):!port(settings.maintenance.port)))throw Error('GATEWAY_SETTINGS_INVALID');
const gateway=createBootstrapGateway(settings.uiPort,settings.maintenance);let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;void gateway.close().then(()=>process.exit(0),()=>process.exit(1))};
process.on('message',message=>{if(message==='stop')stop()});process.on('disconnect',stop);process.on('SIGTERM',stop);process.on('SIGINT',stop);
gateway.server.once('error',()=>{console.error('QICORE_GATEWAY_LISTEN_FAILED');process.exit(1)});
gateway.server.listen(settings.publicPort,'127.0.0.1',()=>{process.send!({ready:true,uid:process.getuid!()})});
