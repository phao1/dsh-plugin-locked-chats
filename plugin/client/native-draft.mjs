/** Prepare an explicitly hidden session before mounting the host-owned editor. */
export async function prepareNativeDraft(client,sessions,workspaceId,existingId) {
  if(!client.state.unlocked)throw new Error('请先验证 PIN。');
  let id=existingId;
  if(!id){
    const requested=crypto.randomUUID();
    await client.setHidden(requested,true);
    // Finish this already reserved hidden draft even if relocked; never mount it below.
    id=await sessions.create({sessionId:requested,workspaceId});
    if(id!==requested){await client.setHidden(id,true);await client.setHidden(requested,false);}
  }
  if(!client.state.unlocked)throw new Error('访问已结束，请重新验证。');
  return id;
}

/** Single-flight per workspace, without sharing a reference between component mounts. */
export function createDraftPreparer(client,sessions) {
  const pending=new Map();
  return (workspaceId,existingId)=>{
    if(!pending.has(workspaceId)){
      const task=prepareNativeDraft(client,sessions,workspaceId,existingId)
        .finally(()=>pending.delete(workspaceId));
      pending.set(workspaceId,task);
    }
    return pending.get(workspaceId);
  };
}
