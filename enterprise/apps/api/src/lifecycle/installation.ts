import { createHash } from 'node:crypto';
import { StateStore } from '../license/store.js';
import { canonicalJson } from '../license/contracts.js';
import { installationReportSchema, type InstallationReport } from './installation-contract.js';
import type { ActiveReceipt, VersionSlot, IntegrityIssue } from './update-engine.js';

type Context = { productId: string; domain: string; instanceId: string; target: VersionSlot; environment: InstallationReport['environment']; requestHash?:string };
export type InstallationAttempt = { id: string; context: Context; status: 'running'|'succeeded'|'failed'|'recovery_required'; phase: InstallationReport['phase']; startedAt: string; code?: string; integrity?:IntegrityIssue[] };
type Attempt = InstallationAttempt;
type Event = { payload: InstallationReport; attempts: number; nextAt: number; acknowledged: boolean };
type Receipt = { schema: 'zjz-installation-v1'; attemptId: string; context: Context; health: 'passed'; completedAt: string };
export type InstallEffects = {
  preflight(): Promise<void>; authorize(): Promise<void>; database(): Promise<void>;
  migrate(): Promise<void>; configure(): Promise<void>; start(): Promise<void>; health(target: VersionSlot): Promise<void>; finalize(target: VersionSlot): Promise<void>;
};
// The dedicated updater owns this store under an OS flock. No browser-supplied success flag is accepted.
export class Installation {
  private busy = false;
  private flushing = false;
  constructor(readonly store: StateStore, readonly effects: InstallEffects) {}
  private event(attempt: Attempt, status: InstallationReport['status'], receipt?: Receipt) {
    const events = this.store.read<Event[]>('installation-outbox.json') ?? [];
    const sequence = events.filter(e => e.payload.attemptId === attempt.id).length;
    const payload = installationReportSchema.parse({ schema:'installation-event-v1', productId:attempt.context.productId,
      domain:attempt.context.domain, attemptId:attempt.id, sequence, status, phase:attempt.phase,
      version:attempt.context.target.version, startedAt:attempt.startedAt, occurredAt:new Date().toISOString(),
      errorCode:attempt.code ?? null, evidenceSha256:receipt ? createHash('sha256').update(canonicalJson(receipt)).digest('hex') : null,
      environment:attempt.context.environment });
    events.push({payload,attempts:0,nextAt:0,acknowledged:false}); this.store.write('installation-outbox.json',events);
  }
  private async complete(attempt:Attempt){
    const receipt:Receipt={schema:'zjz-installation-v1',attemptId:attempt.id,context:attempt.context,health:'passed',completedAt:new Date().toISOString()};
    this.store.write('installed-receipt.json',receipt);
    this.store.write('active.json',{schema:'zjz-xcx-active-v1',current:attempt.context.target,previous:null,health:'passed',taskId:attempt.id,
      committedAt:receipt.completedAt,recoveryReferences:[]} satisfies ActiveReceipt);
    this.store.write('managed-images.json',[attempt.context.target.image]);
    await this.effects.finalize(attempt.context.target);
    attempt.phase='completion';attempt.status='succeeded';delete attempt.code;delete attempt.integrity;
    this.store.write('installation.json',attempt);this.event(attempt,'SUCCEEDED',receipt);
  }
  // An operator may retry only after configuration completed. Never repeat extraction, migrations or administrator creation.
  async resumeHealth(id:string){
    const attempt=this.store.read<Attempt>('installation.json');
    if(this.busy||!attempt||attempt.id!==id||attempt.status!=='recovery_required'||attempt.phase!=='health')throw Error('INSTALL_HEALTH_RECOVERY_NOT_ALLOWED');
    const active=this.store.read<ActiveReceipt>('active.json'),receipt=this.store.read<Receipt>('installed-receipt.json');
    if(active&&(active.taskId!==id||active.previous!==null||canonicalJson(active.current)!==canonicalJson(attempt.context.target))
      ||receipt&&(receipt.attemptId!==id||canonicalJson(receipt.context)!==canonicalJson(attempt.context)))throw Error('INSTALL_RECEIPT_MISMATCH');
    this.busy=true;
    try{
      await this.effects.preflight();await this.effects.authorize();
      attempt.status='running';delete attempt.code;this.store.write('installation.json',attempt);this.event(attempt,'RUNNING');
      await this.effects.start();await this.effects.health(attempt.context.target);await this.complete(attempt);
    }catch(error){
      attempt.status='recovery_required';attempt.code=error instanceof Error&&/^[A-Z][A-Z0-9_]{1,63}$/.test(error.message)?error.message:'INSTALLATION_FAILED';
      this.store.write('installation.json',attempt);this.event(attempt,'RECOVERY_REQUIRED');
    }finally{this.busy=false}
    return attempt;
  }
  async execute(id: string, context: Context) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{64}$/.test(context.instanceId)
      || !/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(context.target.image)) throw Error('INVALID_INSTALL_CONTEXT');
    installationReportSchema.parse({schema:'installation-event-v1',productId:context.productId,domain:context.domain,attemptId:id,
      sequence:0,status:'RUNNING',phase:'start',version:context.target.version,startedAt:new Date().toISOString(),occurredAt:new Date().toISOString(),
      errorCode:null,evidenceSha256:null,environment:context.environment});
    const previous=this.store.read<Attempt>('installation.json');
    if (previous?.id===id) {
      if (canonicalJson(previous.context)!==canonicalJson(context)) throw Error('INSTALL_TARGET_CHANGED');
      return previous;
    }
    if (this.busy || previous || this.store.read('active.json')) throw Error('INSTALLATION_ALREADY_EXISTS');
    this.busy=true;
    const attempt:Attempt={id,context,status:'running',phase:'start',startedAt:new Date().toISOString()};
    try {
      await this.effects.preflight(); await this.effects.authorize();
      this.store.write('installation.json',attempt); this.event(attempt,'RUNNING');
      const phase=(value:Attempt['phase'])=>{attempt.phase=value;this.store.write('installation.json',attempt)};
      phase('database'); await this.effects.database();
      phase('migration'); await this.effects.migrate();
      phase('configuration'); await this.effects.configure(); await this.effects.start();
      phase('health'); await this.effects.health(context.target);
      await this.complete(attempt);
    } catch(error) {
      if (!this.store.read('installation.json')) throw error;
      attempt.status='recovery_required'; attempt.code=error instanceof Error && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.message)?error.message:'INSTALLATION_FAILED';
      if(error instanceof Error&&'integrity' in error&&Array.isArray(error.integrity))attempt.integrity=error.integrity;
      this.store.write('installation.json',attempt); this.event(attempt,'RECOVERY_REQUIRED');
    } finally {this.busy=false}
    return attempt;
  }
  recoverInterrupted() {
    const attempt=this.store.read<Attempt>('installation.json');
    if (!attempt) return;
    const events=this.store.read<Event[]>('installation-outbox.json')??[];
    if(!events.some(e=>e.payload.attemptId===attempt.id))this.event({...attempt,phase:'start',code:undefined},'RUNNING');
    if(attempt.status==='succeeded'&&!events.some(e=>e.payload.attemptId===attempt.id&&e.payload.status==='SUCCEEDED')){
      const receipt=this.store.read<Receipt>('installed-receipt.json'),active=this.store.read<ActiveReceipt>('active.json');
      if(!receipt||receipt.attemptId!==attempt.id||canonicalJson(receipt.context)!==canonicalJson(attempt.context)||active?.taskId!==attempt.id||active.health!=='passed')throw Error('INSTALL_RECEIPT_MISMATCH');
      this.event({...attempt,phase:'completion',code:undefined},'SUCCEEDED',receipt);return;
    }
    if (attempt.status!=='running') return;
    // Never infer successful completion from a running container after a crash.
    attempt.status='recovery_required';attempt.code='INSTALLATION_INTERRUPTED';
    this.store.write('installation.json',attempt); this.event(attempt,'RECOVERY_REQUIRED');
  }
  async flush(send:(payload:InstallationReport)=>Promise<any>,now=Date.now()) {
    if(this.flushing)return;this.flushing=true;
    try {
      for(const event of this.store.read<Event[]>('installation-outbox.json')??[]) {
        if(event.acknowledged)continue;
        if(event.nextAt>now)break; // Preserve sequence even when the first event is in backoff.
        const save=()=>this.store.write('installation-outbox.json',(this.store.read<Event[]>('installation-outbox.json')??[]).map(e=>e.payload.attemptId===event.payload.attemptId&&e.payload.sequence===event.payload.sequence?event:e));
        event.attempts++;event.nextAt=now+Math.min(3600000,5000*2**Math.min(event.attempts-1,10));save();
        try {
          const ack=await send(installationReportSchema.parse(event.payload));
          if(ack.accepted!==true||ack.attemptId!==event.payload.attemptId||ack.sequence!==event.payload.sequence)throw Error('REPORT_NOT_ACKNOWLEDGED');
          event.acknowledged=true;save();
        }catch{break}
      }
    }finally{this.flushing=false}
  }
}
