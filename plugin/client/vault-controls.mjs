import {useTranslation,messageText} from './localization.mjs';
import {createElement as h,useState,useRef} from 'react';
import {Button,Modal,IconFolderCloseRegular,IconChevronDownOutlineRegular} from '@deepseek-ai/dsh-client-ui-primitives';
export function WorkspaceLockControl({client,workspaces,lockedIds,onLocked,renderPicker}) {
  const t=useTranslation();
  const [open,setOpen]=useState(false),[menu,setMenu]=useState(false),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const anchor=useRef(null);
  const choices=workspaces.filter(item=>!lockedIds.includes(item.workspaceId));
  const chosen=choices.find(item=>item.workspaceId===selected);
  return h('div',null,h(Button,{onClick:()=>{setOpen(true);setMenu(false);setSelected('');setError('');},icon:h(IconFolderCloseRegular)},t("lockWorkspace")),
    h(Modal,{open,onClose:()=>!busy&&setOpen(false),title:t("lockWholeWorkspace"),description:t("lockWorkspaceDescription"),closeLabel:t("close"),footer:h('div',{className:'lc-actions'},h(Button,{variant:'outline',disabled:busy,onClick:()=>setOpen(false)},t("cancel")),h(Button,{variant:'primary',disabled:busy||!chosen,onClick:async()=>{setBusy(true);setError('');try{await client.setWorkspaceHidden(selected,true);setOpen(false);await onLocked();}catch(e){setError(e);}finally{setBusy(false);}}},busy?t("locking"):t("lockWorkspace")))},
      choices.length?h('div',null,h(Button,{ref:anchor,variant:'outline',disabled:busy,icon:h(IconFolderCloseRegular),'aria-label':t("chooseWorkspaceToLock"),'aria-haspopup':'menu','aria-expanded':menu,onClick:()=>setMenu(!menu)},chosen?.title||t("chooseWorkspace"),h(IconChevronDownOutlineRegular,{size:12})),renderPicker({open:open&&menu,anchorRef:anchor,selectedId:selected,onPick:id=>{setSelected(id);setMenu(false);},onClose:()=>setMenu(false)})):h('p',null,t("noWorkspaces")),error&&h('p',{role:'alert'},messageText(error,t))));
}
export function WorkspaceUnlockControl({client,workspaceId,title}) {
  const t=useTranslation();
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return h('span',null,h(Button,{size:'sm',onClick:()=>{setOpen(true);setError('');}},t("unlockWorkspace")),
    h(Modal,{open,onClose:()=>!busy&&setOpen(false),title:t("unlockWorkspace"),description:t('unlockWorkspaceDescription',{title}),closeLabel:t("close"),footer:h('div',{className:'lc-actions'},h(Button,{variant:'outline',disabled:busy,onClick:()=>setOpen(false)},t("cancel")),h(Button,{variant:'primary',disabled:busy,onClick:async()=>{setBusy(true);try{await client.setWorkspaceHidden(workspaceId,false);setOpen(false);}catch(e){setError(e);}finally{setBusy(false);}}},t("unlockWorkspace")))},error&&h('p',{role:'alert'},messageText(error,t))));
}
