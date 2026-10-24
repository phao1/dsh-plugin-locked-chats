import {createContext,createElement as h,useContext,useMemo,useSyncExternalStore} from 'react';
import {createTranslator,en,zh} from '../src/locales.ts';

export const defaultTranslate=createTranslator('en');
export const TranslationContext=createContext(defaultTranslate);
export const TranslationProvider=TranslationContext.Provider;
export const useTranslation=()=>useContext(TranslationContext);

/** DSH owns language selection; each plugin scope owns its dictionary/subscription. */
export function installLocalization(ctx) {
  const namespace='locked-chats';
  ctx.effect(()=>ctx.locale.register(namespace,{en,zh}));
  const t=ctx.locale.bind(namespace);
  const source={subscribe:listener=>ctx.locale.subscribe(listener),get:()=>ctx.locale.getSnapshot()};
  function Localized({children}) {
    const snapshot=useSyncExternalStore(source.subscribe,source.get,source.get);
    const translate=useMemo(()=>(key,values)=>t(key,values),[snapshot]);
    return h(TranslationProvider,{value:translate},children);
  }
  return {t,wrap:Component=>function LocalizedComponent(props){return h(Localized,null,h(Component,props));},Localized};
}

/** Keep message identity in state so an already visible error follows a locale switch. */
export function messageText(message,t) {
  if(!message)return '';
  if(message.code)return t(Object.hasOwn(en,`error.${message.code}`)?`error.${message.code}`:'operationFailed',{seconds:message.retryAfterSeconds??60});
  if(message.key)return t(message.key,message.values);
  // Do not expose raw transport/host diagnostics in the UI.
  return typeof message==='string'?message:t('operationFailed');
}
