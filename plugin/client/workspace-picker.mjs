import {createElement as h,useMemo,useSyncExternalStore} from 'react';
import {projectWorkspaces} from './workspace-projection.mjs';

const composedPickers = new WeakSet();

/** Keep the original native picker and directory flow; narrow only their list. */
export function composeWorkspacePicker(slots,client,{target='conversation.hero.workspace',vault=false,lockSelection=false}={}) {
  const source='conversation.hero.workspace',prefix=lockSelection?'locked-chats.lock-picker.':vault?'locked-chats.vault-picker.':'locked-chats.picker.',owned=new Set();
  function Filtered({Original,hostProps}) {
    const useVisibleWorkspaces=useMemo(()=>function useVisibleWorkspaces(selector=value=>value){
      const original=hostProps.useWorkspaces(value=>value);
      const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot);
      const visible=useMemo(()=>state.ready&&(!vault||state.unlocked)?(vault&&!lockSelection?original:projectWorkspaces(original,state)):{...original,phase:'pending',items:[]},[original,state]);
      return selector(visible);
    },[hostProps.useWorkspaces]);
    return h(Original,{...hostProps,...(lockSelection?{useDirectoryFlow:selector=>selector(false)}:{}),useWorkspaces:useVisibleWorkspaces,onPick:id=>{
      // A menu opened before a concurrent lock must not accept its stale item.
      if(client.state.ready&&(vault?client.state.unlocked&&(!lockSelection||!client.state.workspaceIds.includes(id)):!client.state.workspaceIds.includes(id)))hostProps.onPick(id);
      else hostProps.onClose();
    }});
  }
  function mirror(from,to,root=false) {
    let previous=[],disposers=[],stopped=false;
    const clear=()=>{for(const dispose of disposers.splice(0).reverse())dispose();};
    const sync=()=>{
      if(stopped)return;
      const entries=(root?slots.entries(from).filter(entry=>!composedPickers.has(entry.component)).slice(0,1):slots.entriesOfSlot(from).filter(entry=>!owned.has(entry.component)));
      if(previous.length===entries.length&&previous.every((entry,index)=>entry===entries[index]))return;
      previous=entries;clear();
      for(const entry of entries){
        const children=Object.keys(entry.children??{}),mapping=Object.fromEntries(children.map(key=>[key,prefix+key]));
        function Reused(props){
          const forwarded={...props};
          if(children.length){
            const map=key=>{if(!mapping[key])throw new Error('Undeclared composed picker slot: '+key);return mapping[key];};
            forwarded.renderSlot=(key,owner,options)=>props.renderSlot(map(key),owner,options);
            if(props.renderSlotChain)forwarded.renderSlotChain=(key,owner,options)=>props.renderSlotChain(map(key),owner,options);
          }
          return root?h(Filtered,{Original:entry.component,hostProps:forwarded}):h(entry.component,forwarded);
        }
        owned.add(Reused);
        if(root)composedPickers.add(Reused);
        const dispose=slots.register({name:to,...entry.options,
          ...(entry.inject?{inject:entry.inject}:{}),...(entry.store?{store:entry.store}:{}),
          ...(entry.locale?{locale:entry.locale}:{}),...(entry.select?{select:entry.select}:{}),
          ...(children.length?{children:Object.fromEntries(children.map(key=>[mapping[key],entry.children[key]]))}:{}),
          ...(root?{priority:-100}:{}),
        },Reused);
        disposers.push(()=>{dispose();owned.delete(Reused);});
        for(const key of children)disposers.push(mirror(key,mapping[key]));
      }
    };
    const unsubscribe=slots.subscribe(from,sync);sync();
    return()=>{stopped=true;unsubscribe();clear();};
  }
  return mirror(source,target,true);
}
