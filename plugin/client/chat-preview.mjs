import {createElement as h,useEffect,useState,useSyncExternalStore} from 'react';
import {extractMarkdownPlainText} from '@deepseek-ai/dsh-client-ui-primitives';
import {createPreviewLoader,previewRevision} from './chat-preview-model.mjs';

/** One loader per plugin instance; clear on revocation and dispose on plugin unload. */
export function createChatPreviewLoader(sessions,isUnlocked) {
  return {
    ...createPreviewLoader(sessions,isUnlocked,{plainText:extractMarkdownPlainText}),
    // Subscribe only to public catalog metadata; retain-count changes leave this
    // primitive revision unchanged and therefore cannot cause a retain loop.
    subscribe:listener=>sessions.list.subscribe(listener),
    getRevision:sessionId=>previewRevision(sessions.list.getSnapshot().byId[sessionId]),
  };
}

/** Plain text is rendered by React, never injected as HTML or persisted. */
export function ChatPreview({loader,sessionId,revision,unlocked}) {
  const [preview,setPreview]=useState(null);
  const activity=useSyncExternalStore(loader.subscribe,()=>loader.getRevision(sessionId),()=>loader.getRevision(sessionId));
  const currentRevision=`${revision ?? ''}:${activity}`;
  useEffect(()=>{
    setPreview(null);
    if(!unlocked)return;
    const controller=new AbortController();let live=true;
    void loader.load(sessionId,{signal:controller.signal}).then(text=>{
      if(live&&!controller.signal.aborted)setPreview({sessionId,revision:currentRevision,text});
    }).catch(error=>{
      if(live&&!controller.signal.aborted&&error.name!=='AbortError')setPreview({sessionId,revision:currentRevision,text:'摘要暂不可用'});
    });
    return()=>{live=false;controller.abort();};
  },[loader,sessionId,currentRevision,unlocked]);
  if(!unlocked)return null;
  const current=preview?.sessionId===sessionId&&preview.revision===currentRevision?preview.text:'正在读取摘要…';
  return h('span',{className:'lc-chat-preview'},current);
}
