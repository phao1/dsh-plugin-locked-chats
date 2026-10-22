import {createElement as h,useState,useEffect,useRef} from 'react';
import {Button,Input} from '@deepseek-ai/dsh-client-ui-primitives';
import {PrivacyClient} from './model.mjs';

/** Settings section owns its own short-lived credential operation window. */
export function CredentialSettings({onChanged}) {
  const recoveryFile=useRef(null);
  const api=useRef(null); if(!api.current)api.current=new PrivacyClient();
  const [ready,setReady]=useState(false),[configured,setConfigured]=useState(false),[mode,setMode]=useState('');
  const [showPin,setShowPin]=useState(false);
  const [values,setValues]=useState({}),[backup,setBackup]=useState(null),[grant,setGrant]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{let active=true; const client=api.current;
    void client.refresh().then(()=>{if(active){setConfigured(client.state.configured);setReady(client.state.ready);setMessage(client.state.error);}});
    return()=>{active=false;client.close();};
  },[]);
  const choose=next=>{setShowPin(false);setMode(next);setValues({});setMessage('');};
  const cancel=async()=>{if(busy)return;setBusy(true);try{if(backup)await api.current.call('cancel',{operationId:backup.operationId});setShowPin(false);setMode('');setBackup(null);setGrant('');setValues({});setMessage('已取消，原有凭据未改变。');}catch(e){setMessage(e.message);}finally{setBusy(false);}};
  const submit=async e=>{e.preventDefault();if(busy)return;setBusy(true);setMessage('');
    try{await api.current.window();const result=await api.current.call(mode,{...values,...(backup?{operationId:backup.operationId}:{}),...(grant?{recoveryGrant:grant}:{})});
      if(mode==='beginRecovery'){setShowPin(false);setGrant(result.recoveryGrant);setMode('recover');setMessage('恢复码已验证，请设置新 PIN。');}
      else if(['setup','recover','rotateRecovery'].includes(mode)){setShowPin(false);setBackup(result);setMode('confirmBackup');}
      else{setShowPin(false);setMode('');setBackup(null);setGrant('');setConfigured(true);setMessage('凭据已更新，请重新验证锁定聊天。');await onChanged();}
      setValues({});
    }catch(e){setMessage(e.message);}finally{setBusy(false);}
  };
  const field=(name,label,pin=false)=>h('label',{key:name},label,h(Input,{name,type:pin&&name!=='oldPin'&&showPin?'text':'password',value:values[name]||'',onChange:e=>setValues(previous=>({...previous,[name]:e.target.value})),required:true,autoComplete:'off',disabled:busy,...(pin?{inputMode:'numeric',pattern:'[0-9]{4}',maxLength:4}:{maxLength:256})}));
  const download=()=>{const url=URL.createObjectURL(new Blob([backup.recoveryCode+'\n'],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download='dsh-locked-chats-recovery.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const recovery=mode==='beginRecovery'||mode==='confirmBackup';
  return h('section',{className:'lc-credential-settings'},h('h2',null,'PIN 与恢复码'),h('p',null,configured?'已设置 PIN 和恢复码。':'设置一个 4 位 PIN，用于打开锁定聊天。'),
    !ready?h('p',{role:'status'},message||'正在加载…'):!mode?h('div',{className:'lc-settings-choices'},...(configured?[['changePin','修改 PIN'],['beginRecovery','忘记 PIN'],['rotateRecovery','更换恢复码']]:[['setup','首次设置 PIN']]).map(([action,label])=>h(Button,{key:action,onClick:()=>choose(action)},label))):
    h('form',{onSubmit:submit,autoComplete:'off'},
      backup&&h('section',null,h('h3',null,'保存新的恢复码'),h('p',null,'请保存恢复码，并在下方回填确认。确认前原凭据仍然有效。'),h(Input,{'aria-label':'新恢复码',readOnly:true,value:backup.recoveryCode,className:'lc-field',autoComplete:'off',spellCheck:false}),h(Button,{type:'button',onClick:download,disabled:busy},'下载恢复文件')),
      recovery?field('recoveryCode',mode==='confirmBackup'?'输入已保存的新恢复码':'恢复码'):h('div',null,mode==='changePin'&&field('oldPin','当前 PIN',true),field('pin',mode==='rotateRecovery'?'当前 PIN':'新 PIN（4 位数字）',true),mode!=='rotateRecovery'&&field('confirmation','再次输入新 PIN',true)),
      ['setup','recover','changePin'].includes(mode)&&h(Button,{type:'button',size:'sm','aria-pressed':showPin,disabled:busy,onClick:()=>setShowPin(!showPin)},showPin?'隐藏新 PIN':'查看新 PIN'),
      recovery&&h('div',null,h(Button,{type:'button',variant:'outline',disabled:busy,onClick:()=>recoveryFile.current?.click()},'导入恢复文件（可选）'),h('input',{ref:recoveryFile,hidden:true,'aria-label':'恢复文件',type:'file',accept:'.txt,text/plain',disabled:busy,onChange:async e=>{const input=e.target,file=input.files?.[0];if(!file)return;try{if(file.size>1024)throw new Error('恢复文件过大。');const code=(await file.text()).trim();if(!/^DSHR1:[a-f0-9-]+:[A-Za-z2-7]+:[a-fA-F0-9]{8}$/.test(code))throw new Error('恢复文件格式不正确。');setValues(previous=>({...previous,recoveryCode:code}));}catch(error){setMessage(error.message);}finally{input.value='';}}})),
      h('div',{className:'lc-actions'},h(Button,{type:'button',variant:'outline',onClick:cancel,disabled:busy},'取消'),h(Button,{type:'submit',variant:'primary',disabled:busy},busy?'处理中…':mode==='confirmBackup'?'确认备份':'继续'))),
    message&&h('p',{role:'status'},message),h('p',{className:'lc-footnote'},'恢复码可无损重设 PIN。关闭设置会放弃未确认的操作。此功能仅隐藏界面，不加密聊天文件。'));
}
