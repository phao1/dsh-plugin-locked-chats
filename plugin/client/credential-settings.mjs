import {useTranslation,messageText} from './localization.mjs';
import {createElement as h,useState,useEffect,useRef} from 'react';
import {Button,Input} from '@deepseek-ai/dsh-client-ui-primitives';
import {PrivacyClient} from './model.mjs';

/** Settings section owns its own short-lived credential operation window. */
export function CredentialSettings({onChanged}) {
  const t=useTranslation();
  const translate=useRef(t);translate.current=t;
  const recoveryFile=useRef(null);
  const api=useRef(null); if(!api.current)api.current=new PrivacyClient(undefined,(key,values)=>translate.current(key,values));
  const [ready,setReady]=useState(false),[configured,setConfigured]=useState(false),[mode,setMode]=useState('');
  const [showPin,setShowPin]=useState(false);
  const [values,setValues]=useState({}),[backup,setBackup]=useState(null),[grant,setGrant]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{let active=true; const client=api.current;
    void client.refresh().then(()=>{if(active){setConfigured(client.state.configured);setReady(client.state.ready);setMessage(client.state.error);}});
    return()=>{active=false;client.close();};
  },[]);
  const choose=next=>{setShowPin(false);setMode(next);setValues({});setMessage('');};
  const failed=async e=>{
    if(['wrong_connection','expired_operation','stale_operation','already_configured'].includes(e.code)){
      setShowPin(false);setMode('');setBackup(null);setGrant('');setValues({});
      await api.current.refresh();setConfigured(api.current.state.configured);setReady(api.current.state.ready);
    }
    setMessage(e);
  };
  const cancel=async()=>{if(busy)return;setBusy(true);try{if(backup)await api.current.call('cancel',{operationId:backup.operationId});setShowPin(false);setMode('');setBackup(null);setGrant('');setValues({});setMessage({key:"cancelled"});}catch(e){await failed(e);}finally{setBusy(false);}};
  const submit=async e=>{e.preventDefault();if(busy)return;setBusy(true);setMessage('');
    try{await api.current.window();const result=await api.current.call(mode,{...values,...(backup?{operationId:backup.operationId}:{}),...(grant?{recoveryGrant:grant}:{})});
      if(mode==='beginRecovery'){setShowPin(false);setGrant(result.recoveryGrant);setMode('recover');setMessage({key:"recoveryVerified"});}
      else if(['setup','recover','rotateRecovery'].includes(mode)){setShowPin(false);setBackup(result);setMode('confirmBackup');}
      else{setShowPin(false);setMode('');setBackup(null);setGrant('');setConfigured(true);setMessage({key:"credentialsUpdated"});await onChanged();}
      setValues({});
    }catch(e){await failed(e);}finally{setBusy(false);}
  };
  const field=(name,label,pin=false)=>h('label',{key:name},label,h(Input,{name,type:pin&&name!=='oldPin'&&showPin?'text':'password',value:values[name]||'',onChange:e=>setValues(previous=>({...previous,[name]:e.target.value})),required:true,autoComplete:'off',disabled:busy,...(pin?{inputMode:'numeric',pattern:'[0-9]{4}',maxLength:4}:{maxLength:256})}));
  const download=()=>{const url=URL.createObjectURL(new Blob([backup.recoveryCode+'\n'],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download='dsh-locked-chats-recovery.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const recovery=mode==='beginRecovery'||mode==='confirmBackup';
  return h('section',{className:'lc-credential-settings'},h('h2',null,t("settingsTitle")),h('p',null,configured?t("configured"):t("setupDescription")),
    !ready?h('p',{role:'status'},messageText(message,t)||t("loading")):!mode?h('div',{className:'lc-settings-choices'},...(configured?[['changePin',t("changePin")],['beginRecovery',t("forgotPin")],['rotateRecovery',t("rotateRecovery")]]:[['setup',t("setupPin")]]).map(([action,label])=>h(Button,{key:action,onClick:()=>choose(action)},label))):
    h('form',{onSubmit:submit,autoComplete:'off'},
      backup&&h('section',null,h('h3',null,t("saveNewRecovery")),h('p',null,t("saveRecoveryNotice")),h(Input,{'aria-label':t("newRecovery"),readOnly:true,value:backup.recoveryCode,className:'lc-field',autoComplete:'off',spellCheck:false}),h(Button,{type:'button',onClick:download,disabled:busy},t("downloadRecovery"))),
      recovery?field('recoveryCode',mode==='confirmBackup'?t("enterSavedRecovery"):t("recoveryCode")):h('div',null,mode==='changePin'&&field('oldPin',t("currentPin"),true),field('pin',mode==='rotateRecovery'?t("currentPin"):t("newPin"),true),mode!=='rotateRecovery'&&field('confirmation',t("confirmNewPin"),true)),
      ['setup','recover','changePin'].includes(mode)&&h(Button,{type:'button',size:'sm','aria-pressed':showPin,disabled:busy,onClick:()=>setShowPin(!showPin)},showPin?t("hideNewPin"):t("showNewPin")),
      recovery&&h('div',null,h(Button,{type:'button',variant:'outline',disabled:busy,onClick:()=>recoveryFile.current?.click()},t("importRecovery")),h('input',{ref:recoveryFile,hidden:true,'aria-label':t("recoveryFile"),type:'file',accept:'.txt,text/plain',disabled:busy,onChange:async e=>{const input=e.target,file=input.files?.[0];if(!file)return;try{if(file.size>1024)throw {key:'fileTooLarge'};const code=(await file.text()).trim();if(!/^DSHR1:[a-f0-9-]+:[A-Za-z2-7]+:[a-fA-F0-9]{8}$/.test(code))throw {key:'fileInvalid'};setValues(previous=>({...previous,recoveryCode:code}));}catch(error){setMessage(error);}finally{input.value='';}}})),
      h('div',{className:'lc-actions'},h(Button,{type:'button',variant:'outline',onClick:cancel,disabled:busy},t("cancel")),h(Button,{type:'submit',variant:'primary',disabled:busy},busy?t("processing"):mode==='confirmBackup'?t("confirmBackup"):t("continue")))),
    message&&h('p',{role:'status'},messageText(message,t)),h('p',{className:'lc-footnote'},t("settingsFootnote")));
}
