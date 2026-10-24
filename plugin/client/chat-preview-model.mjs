import {createTranslator} from '../src/locales.ts';
const defaultTranslate=createTranslator('en');
const abortError=()=>new DOMException('Preview access ended','AbortError');
const MAX_SOURCE=4096;

/** Host activity time may only track the prompt; turn completion changes running. */
export function previewRevision(row) {
  return row ? `${row.updatedAt ?? 0}:${row.running ? 'running' : 'idle'}` : 'missing';
}

/** Project only readable human/model text from the host's existing tail window. */
export function latestChatPreview(entries,plainText=value=>value,limit=120,t=defaultTranslate) {
  let attachments=false;
  for(let index=entries.length-1;index>=Math.max(0,entries.length-1000);index--){
    const item=entries[index];
    if(item?.type!=='event')continue;
    const event=item.event;
    const message=event?.type==='user/message'&&event.data?.source?.kind==='user'?event.data:
      event?.type==='assistant/message'?event.data?.message:null;
    if(!Array.isArray(message?.content))continue;
    let source='';
    for(const block of message.content.slice(0,256)){
      if(block.type==='image'||block.type==='file')attachments=true;
      if(block.type!=='text'||typeof block.text!=='string')continue;
      const separator=source?' ':'';
      source+=separator+block.text.slice(0,Math.max(0,MAX_SOURCE-source.length-separator.length));
      if(source.length>=MAX_SOURCE)break;
    }
    if(!source.trim())continue;
    const text=plainText(source,{mode:'all'}).replace(/\s+/g,' ').trim();
    if(!text)continue;
    const characters=Array.from(text);
    return characters.length>limit?characters.slice(0,limit-1).join('').trimEnd()+'…':text;
  }
  return attachments?t("attachmentPreview"):t("emptyPreview");
}

/** Short-lived reads only: bounded concurrency, no history paging and no snippet cache. */
export function createPreviewLoader(sessions,isUnlocked,{plainText,maxConcurrent=3,t=defaultTranslate}={}) {
  const queue=[],active=new Set();let generation=0,closed=false;
  const concurrency=Math.max(1,Math.min(3,maxConcurrent));
  const finish=(job,error,value)=>{
    if(job.finished)return;
    job.finished=true;job.detach();
    if(error)job.reject(error);else job.resolve(value);
  };
  const run=async job=>{
    active.add(job);let reference;
    try{
      if(closed||!isUnlocked()||job.generation!==generation||job.controller.signal.aborted)throw abortError();
      reference=sessions.retain(job.sessionId,{source:'controllerOperation',signal:job.controller.signal});
      // Explicit cancellation also makes deliberately late host/mock completions harmless.
      let detachAbort=()=>{};
      const aborted=new Promise((_,reject)=>{
        const cancel=()=>reject(abortError());
        job.controller.signal.addEventListener('abort',cancel,{once:true});
        detachAbort=()=>job.controller.signal.removeEventListener('abort',cancel);
        if(job.controller.signal.aborted)cancel();
      });
      let binding;
      try{binding=await Promise.race([reference.ready,aborted]);}finally{detachAbort();}
      if(closed||!isUnlocked()||job.generation!==generation||job.controller.signal.aborted)throw abortError();
      const state=binding.session.getSnapshot();
      if(state.removed||state.openState==='error')throw new Error(t("previewUnavailable"));
      const snippet=latestChatPreview(binding.eventSource.getSnapshot().entries,plainText,120,t);
      if(!isUnlocked()||job.generation!==generation||job.controller.signal.aborted)throw abortError();
      finish(job,null,snippet);
    }catch(error){finish(job,error);}
    finally{reference?.release();active.delete(job);drain();}
  };
  const drain=()=>{
    while(queue.length&&active.size<concurrency){
      const job=queue.shift();
      if(job.finished)continue;
      if(job.controller.signal.aborted||closed||!isUnlocked()||job.generation!==generation){finish(job,abortError());continue;}
      void run(job);
    }
  };
  const clear=()=>{
    generation++;
    for(const job of queue.splice(0)){job.controller.abort();finish(job,abortError());}
    for(const job of active)job.controller.abort();
  };
  return {
    load(sessionId,{signal}={}){
      if(closed||!isUnlocked()||signal?.aborted)return Promise.reject(abortError());
      return new Promise((resolve,reject)=>{
        const controller=new AbortController();
        const job={sessionId,controller,generation,resolve,reject,finished:false,detach:()=>{}};
        const cancel=()=>{controller.abort();if(!active.has(job))finish(job,abortError());};
        signal?.addEventListener('abort',cancel,{once:true});
        job.detach=()=>signal?.removeEventListener('abort',cancel);
        queue.push(job);drain();
      });
    },
    clear,
    dispose(){closed=true;clear();},
  };
}
