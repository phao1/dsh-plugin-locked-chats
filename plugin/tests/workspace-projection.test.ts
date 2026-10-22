import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore: production projection is deliberately framework-independent JavaScript.
import {protectedIds,vaultIds,projectWorkspaces,inheritedBy} from '../client/workspace-projection.mjs';
// @ts-ignore: production projection is deliberately framework-independent JavaScript.
import {projectCatalog} from '../client/projection.mjs';

function fixture(){
  const byId={
    public:{id:'public',cwd:'/public',displayTitle:'Public'},
    member:{id:'member',cwd:'/locked',displayTitle:'Member'},
    child:{id:'child',parentId:'member',cwd:'/child',displayTitle:'Child'},
    grandchild:{id:'grandchild',parentId:'child',displayTitle:'Grandchild'},
    explicit:{id:'explicit',cwd:'/public',displayTitle:'Explicit'},
    explicitChild:{id:'explicitChild',parentId:'explicit',displayTitle:'Explicit child'},
    archived:{id:'archived',cwd:'/locked',displayTitle:'Archived'},
  };
  const catalog={ids:Object.keys(byId),byId,phase:'ready',projectionsBySession:{public:{values:{title:'Public'}}}};
  const state={ids:['explicit'],explicitIds:['explicit'],workspaceIds:['locked']};
  const items=[{workspaceId:'locked',path:'/locked',sessionIds:['member','archived']},{workspaceId:'public',path:'/public',sessionIds:['public','explicit']}];
  return {catalog,state,items};
}

test('live workspace members and descendants are protected before the next server snapshot',()=>{
  const {catalog,state,items}=fixture();
  assert.deepEqual([...protectedIds(catalog,state,items)].sort(),['child','explicit','explicitChild','grandchild','member','archived'].sort());
  const future={id:'future',cwd:'/locked'},futureChild={id:'futureChild',parentId:'future'};
  const updated={...catalog,ids:[...catalog.ids,'future','futureChild'],byId:{...catalog.byId,future,futureChild}};
  assert.equal(protectedIds(updated,state,items).has('future'),true);
  assert.equal(protectedIds(updated,state,items).has('futureChild'),true);
  const attached={id:'attached',cwd:'/different'};
  const withAttached={...updated,byId:{...updated.byId,attached}};
  const updatedWorkspaces=items.map(item=>item.workspaceId==='locked'?{...item,sessionIds:[...item.sessionIds,'attached']}:item);
  assert.equal(protectedIds(withAttached,state,updatedWorkspaces).has('attached'),true);
  assert.deepEqual(state.ids,['explicit']);
});

test('all protected families remain available in the vault and unlocking restores ordinary membership',()=>{
  const {catalog,state,items}=fixture();
  const later={id:'later',parentId:'grandchild'};
  const updated={...catalog,ids:[...catalog.ids,'later'],byId:{...catalog.byId,later}};
  const protectedSet=protectedIds(updated,state,items);
  assert.deepEqual(projectCatalog(updated,protectedSet).ids,['public']);
  const vault=vaultIds(updated,state,items);
  assert.deepEqual(new Set(vault),protectedSet);
  assert.equal(vault.includes('later'),true);
  const unlocked={...state,workspaceIds:[]};
  assert.deepEqual(vaultIds(updated,unlocked,items).sort(),['explicit','explicitChild']);
  assert.equal(projectCatalog(updated,protectedIds(updated,unlocked,items)).ids.includes('later'),true);
  assert.equal(updated.byId.later,later);
});

test('projections preserve native objects, metadata, pin order and workspace session membership',()=>{
  const {catalog,state,items}=fixture();
  const snapshot={items,pinnedSessionIds:['member','public'],archivedSessionIds:['archived'],revision:42};
  const before=JSON.stringify({catalog,state,snapshot});
  const projected=projectWorkspaces(snapshot,state);
  assert.deepEqual(projected.items.map((item:{workspaceId:string})=>item.workspaceId),['public']);
  assert.equal(projected.items[0],items[1]);
  assert.equal(projected.pinnedSessionIds,snapshot.pinnedSessionIds);
  assert.equal(projected.archivedSessionIds,snapshot.archivedSessionIds);
  assert.equal(projected.revision,42);
  const projectedCatalog=projectCatalog(catalog,protectedIds(catalog,state,items));
  assert.equal(projectedCatalog.byId.public,catalog.byId.public);
  assert.equal(projectedCatalog.projectionsBySession.public,catalog.projectionsBySession.public);
  assert.equal(JSON.stringify({catalog,state,snapshot}),before);
});

test('inherited reason distinguishes workspace and ancestor locks, even when a child has its own marker',()=>{
  const {catalog,state,items}=fixture();
  assert.equal(inheritedBy(catalog,state,items,'member'),'workspace');
  assert.equal(inheritedBy(catalog,state,items,'grandchild'),'workspace');
  assert.equal(inheritedBy(catalog,state,items,'explicit'),null);
  assert.equal(inheritedBy(catalog,state,items,'explicitChild'),'ancestor');
  assert.equal(inheritedBy(catalog,{...state,explicitIds:[...state.explicitIds,'explicitChild']},items,'explicitChild'),'ancestor');
  assert.equal(inheritedBy(catalog,state,items,'public'),null);
  const missingParent={id:'missingParent',parentId:'server-locked-parent'};
  assert.equal(inheritedBy({...catalog,byId:{...catalog.byId,missingParent}},{...state,ids:[...state.ids,'server-locked-parent']},items,'missingParent'),'ancestor');
  const unlockedWorkspace={...state,workspaceIds:[]};
  assert.equal(inheritedBy(catalog,unlockedWorkspace,items,'grandchild'),null);
  assert.equal(inheritedBy(catalog,unlockedWorkspace,items,'explicitChild'),'ancestor');
});
