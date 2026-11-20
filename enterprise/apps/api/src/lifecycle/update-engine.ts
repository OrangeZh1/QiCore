// Adapted from school-shop lifecycle; product identity and state are independent.
import { StateStore } from '../license/store.js';

// image is the legacy persisted artifact-reference field. Native slots use native/<packageKey>@sha256:<manifest>.
export type VersionSlot = { version: string; image: string };
export type UpdateTarget = { from: VersionSlot; to: VersionSlot; planId: string; rollbackCompatible: boolean; migrations: { id: string; sha256: string; reversible: boolean }[]; releaseNotes?: string };
export type IntegrityIssue={path:string;kind:'modified'|'missing'|'unknown'|'unsafe'};
export type UpdateTask = { id: string; mode?: 'initial-repair'; operation?:'install'|'repair'|'uninstall'; componentTarget?:{from:VersionSlot|null;to:VersionSlot|null;releaseNotes:string}; request?: {packageKey:string;targetVersion:string;manifestSha256:string;operation?:'install'|'repair'|'uninstall'}; integrity?:IntegrityIssue[]; createdAt: string; updatedAt: string; status: 'running' | 'succeeded' | 'rolled_back' | 'blocked' | 'recovery_required'; step: string; code?: string; failureCode?: string; target?: UpdateTarget; backup?: { id: string; sha256: string }; previousBefore?: VersionSlot | null };
export type ActiveReceipt = { schema: 'zjz-xcx-active-v1'; current: VersionSlot; previous: VersionSlot | null; health: 'passed'; taskId: string; committedAt: string; recoveryReferences: string[] };
// Effects are fixed project operations, never shell strings from a request or release notes.
export type UpdateEffects = {
  authorize(): Promise<UpdateTarget>;
  inventory(): Promise<void>;
  prepareRecoveryImages(keep: VersionSlot[]): Promise<void>;
  pull(target: VersionSlot): Promise<void>;
  compatibility(target: UpdateTarget): Promise<void>;
  maintenance(enabled: boolean): Promise<void>;
  stop(): Promise<void>;
  backup(taskId: string): Promise<{ id: string; sha256: string; verified: boolean }>;
  migrate(target: UpdateTarget): Promise<void>;
  switchTo(target: VersionSlot): Promise<void>;
  health(target: VersionSlot): Promise<void>;
  cleanup(keep: VersionSlot[], references: string[]): Promise<void>;
  abortPreparation?(): Promise<void>;
  assertOpen?(): void;
};
const digestImage = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/;
export function validateTarget(target: UpdateTarget, sameVersionRepair = false) {
  if (!target || !digestImage.test(target.from.image) || !digestImage.test(target.to.image)
    || !/^\d+\.\d+\.\d+$/.test(target.from.version) || !/^\d+\.\d+\.\d+$/.test(target.to.version)
    || target.from.image === target.to.image || !sameVersionRepair && target.from.version === target.to.version || !target.planId) throw new Error('INVALID_UPDATE_TARGET');
  const from = target.from.version.split('.').map(Number), to = target.to.version.split('.').map(Number);
  const changed = from.findIndex((value, index) => value !== to[index]);
  if (changed < 0 ? !sameVersionRepair || target.migrations.length !== 0 : sameVersionRepair || to[changed] < from[changed]) throw new Error('UPDATE_VERSION_NOT_NEWER');
  if (!target.rollbackCompatible || target.migrations.some(item => !item.reversible)) throw new Error('MANUAL_UPGRADE_REQUIRED');
  const seen = new Set<string>();
  for (const item of target.migrations) {
    if (!/^[a-z0-9_]{1,191}$/.test(item.id) || !/^[a-f0-9]{64}$/.test(item.sha256) || seen.has(item.id)) throw new Error('INVALID_MIGRATION');
    seen.add(item.id);
  }
}
export class UpdateEngine {
  private busy = false;
  constructor(readonly store: StateStore, readonly effects: UpdateEffects, private readonly sameVersionRepair = false) {}
  tasks() { return this.store.read<UpdateTask[]>('tasks.json') ?? []; }
  private save(task: UpdateTask) {
    task.updatedAt = new Date().toISOString();
    const tasks = this.tasks(), index = tasks.findIndex(item => item.id === task.id);
    if (index < 0) tasks.push(task); else tasks[index] = task;
    this.store.write('tasks.json', tasks);
  }
  private interrupted(task:UpdateTask,error:unknown){
    let closing=error instanceof Error&&error.message==='RUNTIME_HOST_CLOSING';
    try{this.effects.assertOpen?.()}catch(cause){closing=closing||cause instanceof Error&&cause.message==='RUNTIME_HOST_CLOSING'}
    if(!closing)return false;
    if(error instanceof Error&&error.message!=='RUNTIME_HOST_CLOSING')task.failureCode=/^[A-Z][A-Z0-9_]{1,63}$/.test(error.message)?error.message:'UPDATE_STEP_FAILED';
    task.status='running';task.code='UPDATE_INTERRUPTED';this.save(task);return true;
  }
  async execute(id: string, request?: UpdateTask['request']) {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) throw new Error('INVALID_REQUEST_ID');
    const old = this.tasks().find(item => item.id === id); if (old) { if (JSON.stringify(old.request)!==JSON.stringify(request)) throw Error('REQUEST_ID_REUSED'); return old; }
    if (this.busy || this.tasks().some(item => ['running', 'recovery_required'].includes(item.status))) throw new Error('UPDATE_ALREADY_ACTIVE');
    this.busy = true;
    const task: UpdateTask = { id, ...(this.sameVersionRepair?{mode:'initial-repair' as const}:{}), ...(request?{request}:{}), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'running', step: 'AUTHORIZE' };
    const step = (value: string) => { task.step = value; this.save(task); };
    try {
      this.save(task);
      task.target = await this.effects.authorize(); validateTarget(task.target, this.sameVersionRepair);
      const active = this.store.read<ActiveReceipt>('active.json');
      if (!active || active.current.image !== task.target.from.image || active.current.version !== task.target.from.version) throw new Error('ACTIVE_RECEIPT_REQUIRED');
      task.previousBefore = active.previous;
      step('INVENTORY'); await this.effects.inventory();
      // Keep the preflight step understood by already-installed product UIs.
      await this.effects.prepareRecoveryImages([task.target.to, task.target.from, ...(active.previous ? [active.previous] : [])]);
      step('PULL'); await this.effects.pull(task.target.to);
      step('COMPATIBILITY'); await this.effects.compatibility(task.target);
      step('MAINTENANCE'); await this.effects.maintenance(true);
      step('STOP'); await this.effects.stop();
      step('BACKUP'); const backup = await this.effects.backup(task.id);
      if (!backup || !/^backup-[A-Za-z0-9_-]{16,64}$/.test(backup.id) || !/^[a-f0-9]{64}$/.test(backup.sha256) || backup.verified!==true) throw new Error('BACKUP_RECEIPT_REQUIRED');
      task.backup = backup;
      this.effects.assertOpen?.();
      step('MIGRATE'); await this.effects.migrate(task.target);
      step('SWITCH'); await this.effects.switchTo(task.target.to);
      step('HEALTH'); await this.effects.health(task.target.to);
      step('COMMIT');
      // The fsync + atomic rename in StateStore is the durable commit condition.
      this.store.write('active.json', { schema: 'zjz-xcx-active-v1', current: task.target.to, previous: null,
        health: 'passed', taskId: id, committedAt: new Date().toISOString(), recoveryReferences: [task.backup.id] } satisfies ActiveReceipt);
      step('CLEANUP');
      await this.effects.health(task.target.to);
      await this.effects.maintenance(false);
      await this.effects.cleanup([task.target.to], [task.backup.id]);
      await this.effects.inventory();
      task.status = 'succeeded'; task.step = 'COMPLETE'; this.save(task);
    } catch (error) {
      if(this.interrupted(task,error))return task;
      task.code = error instanceof Error && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.message) ? error.message : 'UPDATE_STEP_FAILED';
      task.failureCode = task.code;
      if(error instanceof Error && 'integrity' in error && Array.isArray(error.integrity))task.integrity=error.integrity.slice(0,20);
      this.save(task);
      await this.recoverTask(task);
    } finally { this.busy = false; }
    return task;
  }
  private async recoverTask(task: UpdateTask, resumeCloseout = false) {
    const active = this.store.read<ActiveReceipt>('active.json');
    const rollbackCommitted = active?.taskId === `${task.id}.rollback`;
    if (active && (active.taskId === task.id || rollbackCommitted)) {
      // New code is already healthy and durably committed. Never roll it back for a cleanup error.
      const expected = rollbackCommitted ? task.target?.from : task.target?.to;
      if (resumeCloseout && expected && active.current.image === expected.image && active.current.version === expected.version) {
        try {
          await this.effects.health(active.current);
          // Upgrade legacy closeout receipts before releasing their old-code references.
          this.store.write('active.json', {...active, previous:null});
          await this.effects.maintenance(false);
          await this.effects.cleanup([active.current], active.recoveryReferences);
          await this.effects.inventory();
          task.status = rollbackCommitted ? 'rolled_back' : 'succeeded'; task.step = 'COMPLETE';
          if (rollbackCommitted) task.code = task.failureCode ?? 'UPDATE_STEP_FAILED'; else delete task.code;
          this.save(task); return;
        } catch (error) {
          if(this.interrupted(task,error))return;
          task.failureCode = error instanceof Error && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.message) ? error.message : 'CLOSEOUT_FAILED';
        }
      }
      task.status = 'recovery_required'; task.code = rollbackCommitted ? 'ROLLBACK_CLOSEOUT_BLOCKED' : 'ACTIVE_HEALTHY_CLOSEOUT_BLOCKED'; this.save(task); return;
    }
    if (task.step === 'MIGRATE') {
      task.status = 'recovery_required'; task.code = 'MIGRATION_RECOVERY_REQUIRED'; this.save(task); return;
    }
    if (['AUTHORIZE', 'INVENTORY', 'RECOVERY_ARCHIVE', 'PULL', 'COMPATIBILITY','MAINTENANCE'].includes(task.step)) {
      try { await this.effects.abortPreparation?.(); }
      catch { task.status='recovery_required'; task.code='PREPARATION_CLEANUP_REQUIRED'; this.save(task); return; }
      task.status = 'blocked'; this.save(task); return;
    }
    if (!task.target) { task.status = 'recovery_required'; this.save(task); return; }
    try {
      validateTarget(task.target, task.mode === 'initial-repair');
      if (!active || active.current.image !== task.target.from.image || active.current.version !== task.target.from.version) throw new Error('RECOVERY_RECEIPT_MISMATCH');
      // Never restore a database snapshot over live data. Only rollback-compatible code is automatic.
      await this.effects.maintenance(true); await this.effects.stop();
      await this.effects.switchTo(task.target.from); await this.effects.health(task.target.from);
      const references = task.backup ? [task.backup.id] : active.recoveryReferences;
      this.store.write('active.json', { schema: 'zjz-xcx-active-v1', current: task.target.from,
        previous: null, health: 'passed', taskId: `${task.id}.rollback`, committedAt: new Date().toISOString(), recoveryReferences: references } satisfies ActiveReceipt);
      await this.effects.maintenance(false);
      await this.effects.cleanup([task.target.from], references);
      await this.effects.inventory();
      task.status = 'rolled_back'; this.save(task);
    } catch (error) {
      if(this.interrupted(task,error))return;
      task.status = 'recovery_required';
      task.code = this.store.read<ActiveReceipt>('active.json')?.taskId === `${task.id}.rollback` ? 'ROLLBACK_CLOSEOUT_BLOCKED' : 'ROLLBACK_REQUIRES_OPERATOR';
      this.save(task);
    }
  }
  async recover() {
    if (this.busy) throw new Error('UPDATE_ALREADY_ACTIVE');
    this.busy = true;
    try { for (const task of this.tasks().filter(item => !item.operation&&(item.status === 'running'
      || item.status === 'recovery_required' && ['ACTIVE_HEALTHY_CLOSEOUT_BLOCKED', 'ROLLBACK_CLOSEOUT_BLOCKED'].includes(item.code ?? '')))) await this.recoverTask(task, true); }
    finally { this.busy = false; }
  }
  async resumeCloseout(id: string) {
    if (this.busy) throw new Error('UPDATE_ALREADY_ACTIVE');
    const task = this.tasks().find(item => item.id === id && item.status === 'recovery_required'
      && ['ACTIVE_HEALTHY_CLOSEOUT_BLOCKED', 'ROLLBACK_CLOSEOUT_BLOCKED'].includes(item.code ?? ''));
    if (!task) throw new Error('CLOSEOUT_NOT_RETRYABLE');
    this.busy = true;
    try {
      task.status = 'running'; task.step = 'CLEANUP'; this.save(task);
      await this.recoverTask(task, true);
      return task;
    } finally { this.busy = false; }
  }
}
