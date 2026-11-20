import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// One product process writes each store. The updater has a separate state root.
// A corrupt record is a recovery error; it must never become an empty installation.
export class StateStore {
  constructor(readonly root: string) { mkdirSync(root, { recursive: true, mode: 0o700 }); }
  path(name: string) {
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(name)) throw new Error('INVALID_STATE_NAME');
    return resolve(this.root, name);
  }
  read<T>(name: string): T | null {
    const path = this.path(name);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T : null;
  }
  write(name: string, value: unknown) {
    const path = this.path(name), temporary = `${path}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
    // Linux rename durability requires the containing directory to be synced too.
    if (process.platform !== 'win32') {
      const directory = openSync(dirname(path), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  }
  remove(name: string) { if (existsSync(this.path(name))) unlinkSync(this.path(name)); }
}
