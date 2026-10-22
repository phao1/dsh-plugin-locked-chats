import {hiddenFamily} from './projection.mjs';
/** Live membership projection closes the gap before the next server snapshot. */
export function protectedIds(catalog,state,workspaces) {
  const ids=new Set(state.ids),locked=new Set(state.workspaceIds||[]);
  const paths=new Set();
  for(const workspace of workspaces){
    if(!locked.has(workspace.workspaceId))continue;
    paths.add(workspace.path);for(const id of workspace.sessionIds)ids.add(id);
  }
  for(const row of Object.values(catalog.byId))if(paths.has(row.cwd))ids.add(row.id);
  return hiddenFamily(catalog,ids);
}
export function vaultIds(catalog,state,workspaces) {
  return [...protectedIds(catalog,state,workspaces)];
}
export function projectWorkspaces(snapshot,state) {
  const hidden=new Set(state.workspaceIds||[]);
  return {...snapshot,items:snapshot.items.filter(item=>!hidden.has(item.workspaceId))};
}

/** A row can have an explicit marker and still inherit another lock that prevents revealing it. */
export function inheritedBy(catalog,state,workspaces,id) {
  const workspaceIds=new Set(state.workspaceIds||[]),members=new Set(),paths=new Set();
  for(const workspace of workspaces){
    if(!workspaceIds.has(workspace.workspaceId))continue;
    paths.add(workspace.path);for(const member of workspace.sessionIds)members.add(member);
  }
  const chain=[],seen=new Set();let current=id;
  while(current&&!seen.has(current)){
    seen.add(current);chain.push(current);current=catalog.byId[current]?.parentId;
  }
  if(chain.some(member=>members.has(member)||paths.has(catalog.byId[member]?.cwd)))return 'workspace';
  const protectedRoots=new Set([...(state.ids||[]),...(state.explicitIds||[])]);
  return chain.slice(1).some(member=>protectedRoots.has(member))?'ancestor':null;
}
