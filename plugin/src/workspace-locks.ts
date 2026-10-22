/** Uses only public workspace entities, live Session headers and persistence listing. */
import { realpathSync } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';
import type { HiddenChats } from './hidden-chats.ts';
import { LockError } from './errors.ts';

export interface LockSessionHeader { readonly id: string; readonly cwd?: string; readonly parentSession?: string }
export interface LockWorkspace { readonly id: string; readonly path: string; readonly sessionIds: readonly string[] }
export interface WorkspaceLockHost {
  readonly workspaceRegistry: {list(): readonly LockWorkspace[]};
  readonly sessions: {list(): readonly {header:LockSessionHeader}[]; get(id:string): {header:LockSessionHeader} | undefined};
  readonly sessionPersistence: {list(): Promise<readonly {header:LockSessionHeader}[]>};
}
export interface LockSnapshot {
  ids: string[];
  explicitIds: string[];
  workspaceIds: string[];
}
function canonical(path: string | undefined): string | undefined {
  if (!path || !isAbsolute(path)) return undefined;
  try { return realpathSync(path); } catch { return normalize(path); }
}

export class WorkspaceLocks {
  private readonly headers = new Map<string,LockSessionHeader>();
  readonly store:HiddenChats;
  readonly host:WorkspaceLockHost;
  constructor(store:HiddenChats,host:WorkspaceLockHost) { this.store=store;this.host=host; }
  observeHeader(header:LockSessionHeader): void { this.headers.set(header.id,header); }
  async refresh(): Promise<void> {
    const stored=await this.host.sessionPersistence.list();
    this.headers.clear();
    for(const entry of stored)this.observeHeader(entry.header);
    for(const session of this.host.sessions.list())this.observeHeader(session.header);
  }
  private header(id:string): LockSessionHeader | undefined {
    return this.host.sessions.get(id)?.header ?? this.headers.get(id);
  }
  private familyHas(header:LockSessionHeader,roots:Set<string>): boolean {
    const seen=new Set<string>();let current:LockSessionHeader|undefined=header;
    while(current&&!seen.has(current.id)){
      if(roots.has(current.id))return true;
      if(current.parentSession&&roots.has(current.parentSession))return true;
      seen.add(current.id);current=current.parentSession ? this.header(current.parentSession) : undefined;
    }
    return false;
  }
  private protected(header:LockSessionHeader): boolean {
    const explicit=new Set(this.store.list());
    if(this.familyHas(header,explicit))return true;
    const locks=this.store.listWorkspaces(),ids=new Set(locks.map(row=>row.id)),paths=new Set(locks.map(row=>row.path));
    const members=new Set(this.host.workspaceRegistry.list().filter(w=>ids.has(w.id)).flatMap(w=>[...w.sessionIds]));
    const seen=new Set<string>();let current:LockSessionHeader|undefined=header;
    while(current&&!seen.has(current.id)){
      if(members.has(current.id)||paths.has(canonical(current.cwd)??''))return true;
      if(current.parentSession&&members.has(current.parentSession))return true;
      seen.add(current.id);current=current.parentSession?this.header(current.parentSession):undefined;
    }
    return false;
  }
  isLocked(header:LockSessionHeader): boolean { return this.protected(header); }
  isLockedId(id:string): boolean {
    const header=this.header(id);
    if(header){
      if(this.isLocked(header))return true;
      // Ordinary memory is allowed only after the entire ancestry is known.
      const seen=new Set<string>();let current:LockSessionHeader|undefined=header;
      while(current){
        if(seen.has(current.id))throw new LockError('session_not_found');
        seen.add(current.id);
        if(!current.parentSession)return false;
        current=this.header(current.parentSession);
        if(!current)throw new LockError('session_not_found');
      }
    }
    if(this.store.isExplicit(id))return true;
    // A model tool must not silently treat an unknown session as ordinary memory.
    throw new LockError('session_not_found');
  }
  async snapshot(): Promise<LockSnapshot> {
    await this.refresh();
    const explicitIds=this.store.list(),workspaceIds=this.store.listWorkspaces().map(row=>row.id);
    const ids=new Set(explicitIds);
    for(const header of this.headers.values()){
      if(this.isLocked(header))ids.add(header.id);
    }
    return {ids:[...ids].sort(),explicitIds,workspaceIds};
  }
  setWorkspace(id:string,hidden:boolean): void {
    const workspace=this.host.workspaceRegistry.list().find(row=>row.id===id);
    if(hidden&&!workspace)throw new LockError('workspace_not_found');
    this.store.setWorkspace(id,canonical(workspace?.path)??'',hidden);
  }
}
