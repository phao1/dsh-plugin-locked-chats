/** Plugin-owned visibility metadata only. No session content or project files are moved. */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { LockError } from './errors.ts';

export interface WorkspaceLock { id: string; path: string }
function validId(id: string): void {
  if (!id || id.length > 512 || /[\x00-\x1f]/.test(id)) throw new LockError('invalid_input');
}
export class HiddenChats {
  private readonly db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'hidden-chats.sqlite');
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    try {
      this.db.exec(`PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS hidden_chats (id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS hidden_workspaces (id TEXT PRIMARY KEY, path TEXT NOT NULL);`);
      // Older builds hid recycle-bin roots without necessarily giving them an
      // explicit lock. Keep those chats and all descendants protected while
      // retiring the feature; no host session or workspace record is touched.
      this.db.exec('BEGIN IMMEDIATE');
      try {
        if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='trashed_chats'").get()) {
          this.db.exec(`INSERT OR IGNORE INTO hidden_chats(id) SELECT id FROM trashed_chats;
            DROP TABLE trashed_chats;`);
        }
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    } catch (error) { this.db.close(); throw error; }
  }
  list(): string[] { return this.db.prepare('SELECT id FROM hidden_chats ORDER BY id').all().map(row => String(row.id)); }
  isExplicit(id: string): boolean { return this.db.prepare('SELECT 1 FROM hidden_chats WHERE id=?').get(id) !== undefined; }
  set(id: string, hidden: boolean): void {
    validId(id);
    this.db.prepare(hidden ? 'INSERT OR IGNORE INTO hidden_chats(id) VALUES (?)' : 'DELETE FROM hidden_chats WHERE id=?').run(id);
  }
  listWorkspaces(): WorkspaceLock[] {
    return this.db.prepare('SELECT id,path FROM hidden_workspaces ORDER BY id').all().map(row => ({id:String(row.id),path:String(row.path)}));
  }
  setWorkspace(id: string, path: string, hidden: boolean): void {
    validId(id);
    if (hidden && (!isAbsolute(path) || /[\x00-\x1f]/.test(path))) throw new LockError('invalid_input');
    this.db.prepare(hidden ? 'INSERT OR REPLACE INTO hidden_workspaces(id,path) VALUES (?,?)' : 'DELETE FROM hidden_workspaces WHERE id=?')
      .run(...(hidden ? [id,path] : [id]));
  }
  close(): void { this.db.close(); }
}
