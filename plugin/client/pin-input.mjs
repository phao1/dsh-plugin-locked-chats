import {useTranslation,messageText} from './localization.mjs';
import {createElement as h,useEffect,useRef,useState} from 'react';
import {Button,Input} from '@deepseek-ai/dsh-client-ui-primitives';

/** Exactly one automatic attempt for each completed input; no retry loop after failure. */
export function useAutoVerifyPin(pin,enabled,verify) {
  const last=useRef(''),callback=useRef(verify);callback.current=verify;
  useEffect(()=>{
    if(!enabled||!/^[0-9]{4}$/.test(pin)){last.current='';return;}
    if(last.current===pin)return;
    last.current=pin;void callback.current();
  },[pin,enabled]);
}

export function PinCells({label,value,onChange,disabled,allowReveal=false}) {
  const t=useTranslation();
  const refs=useRef([]),[visible,setVisible]=useState(false);
  useEffect(()=>{if(!value&&!disabled)refs.current[0]?.focus();},[value,disabled]);
  return h('div',null,h('fieldset',{className:'lc-pin-cells',disabled},h('legend',null,label),
    [0,1,2,3].map(index=>h(Input,{key:index,className:'lc-pin-cell',ref:node=>{refs.current[index]=node;},type:visible?'text':'password',inputMode:'numeric',autoComplete:'off',autoFocus:index===0,maxLength:1,
      'data-modal-autofocus':index===0?true:undefined,'aria-label':t('pinDigit',{label,index:index+1}),value:(value[index]||'').trim(),pattern:'[0-9]',required:true,
      onChange:e=>{const digit=e.target.value.replace(/\D/g,'').slice(-1);const cells=value.padEnd(4,' ').split('');cells[index]=digit||' ';onChange(cells.join('').trimEnd());if(digit)refs.current[index+1]?.focus();},
      onKeyDown:e=>{if(e.key==='Backspace'&&!value[index]?.trim()){e.preventDefault();if(index>0){const cells=value.padEnd(4,' ').split('');cells[index-1]=' ';onChange(cells.join('').trimEnd());refs.current[index-1]?.focus();}}if(e.key==='ArrowLeft')refs.current[index-1]?.focus();if(e.key==='ArrowRight')refs.current[index+1]?.focus();},
      onPaste:e=>{const digits=e.clipboardData.getData('text').replace(/\D/g,'').slice(0,4);if(digits){e.preventDefault();onChange(digits);refs.current[Math.min(digits.length,3)]?.focus();}}}))),
    allowReveal&&h(Button,{type:'button',size:'sm',className:'lc-reveal-pin','aria-pressed':visible,disabled,onClick:()=>setVisible(!visible)},visible?t("hidePin"):t("showPin")));
}
