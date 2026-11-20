import {createHash} from 'node:crypto';
import {StateStore} from '../license/store.js';
import {canonicalJson} from '../license/contracts.js';
import type {UpdateTask,ActiveReceipt} from './update-engine.js';

type RecordItem={payload:Record<string,unknown>;acknowledged:boolean;attempts:number;nextAt:number};
export class UpdateReports {
  private busy=false;
  constructor(readonly store:StateStore,readonly domain:string){}
  async flush(send:(payload:Record<string,unknown>)=>Promise<any>,now=Date.now()){
    if(this.busy)return;this.busy=true;
    try{
      const reports=this.store.read<Record<string,RecordItem>>('outcome-reports.json')??{};
      for(const task of this.store.read<UpdateTask[]>('tasks.json')??[]){
        // Recovery is not terminal: don't seal a result that may still be safely completed later.
        if(!['succeeded','rolled_back','blocked'].includes(task.status)||!task.target?.planId)continue;
        let record=reports[task.id];
        if(!record){
          const active=this.store.read<ActiveReceipt>('active.json');
          record=reports[task.id]={payload:{schema:'qilicense-docker-outcome-v1',planId:task.target.planId,domain:this.domain,
            status:task.status==='succeeded'?'SUCCEEDED':task.status==='rolled_back'?'ROLLED_BACK':'FAILED',
            activeVersion:task.status==='succeeded'?task.target.to.version:task.target.from.version,
            evidenceSha256:createHash('sha256').update(canonicalJson({task,active})).digest('hex'),errorCode:task.status==='succeeded'?null:task.code??'UPDATE_BLOCKED'},acknowledged:false,attempts:0,nextAt:0};
        }
        if(record.acknowledged||record.nextAt>now)continue;
        record.attempts++;record.nextAt=now+Math.min(3600000,5000*2**Math.min(record.attempts-1,10));this.store.write('outcome-reports.json',reports);
        try{const ack=await send(record.payload);if(ack.accepted===true)record.acknowledged=true}catch{}
        this.store.write('outcome-reports.json',reports);
      }
    }finally{this.busy=false}
  }
}
