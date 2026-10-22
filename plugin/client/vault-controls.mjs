import {createElement as h,useState,useRef} from 'react';
import {Button,Modal,IconFolderCloseRegular,IconChevronDownOutlineRegular} from '@deepseek-ai/dsh-client-ui-primitives';
export function WorkspaceLockControl({client,workspaces,lockedIds,onLocked,renderPicker}) {
  const [open,setOpen]=useState(false),[menu,setMenu]=useState(false),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const anchor=useRef(null);
  const choices=workspaces.filter(item=>!lockedIds.includes(item.workspaceId));
  const chosen=choices.find(item=>item.workspaceId===selected);
  return h('div',null,h(Button,{onClick:()=>{setOpen(true);setMenu(false);setSelected('');setError('');},icon:h(IconFolderCloseRegular)},'锁定工作区'),
    h(Modal,{open,onClose:()=>!busy&&setOpen(false),title:'锁定整个工作区',description:'工作区及其中现有和以后新建的聊天将从普通列表与搜索中隐藏，只在验证 PIN 后显示。工作目录和文件不会移动。',closeLabel:'关闭',footer:h('div',{className:'lc-actions'},h(Button,{variant:'outline',disabled:busy,onClick:()=>setOpen(false)},'取消'),h(Button,{variant:'primary',disabled:busy||!chosen,onClick:async()=>{setBusy(true);setError('');try{await client.setWorkspaceHidden(selected,true);setOpen(false);await onLocked();}catch(e){setError(e.message);}finally{setBusy(false);}}},busy?'正在锁定…':'锁定工作区'))},
      choices.length?h('div',null,h(Button,{ref:anchor,variant:'outline',disabled:busy,icon:h(IconFolderCloseRegular),'aria-label':'选择要锁定的工作区','aria-haspopup':'menu','aria-expanded':menu,onClick:()=>setMenu(!menu)},chosen?.title||'选择工作区',h(IconChevronDownOutlineRegular,{size:12})),renderPicker({open:open&&menu,anchorRef:anchor,selectedId:selected,onPick:id=>{setSelected(id);setMenu(false);},onClose:()=>setMenu(false)})):h('p',null,'没有可锁定的工作区。'),error&&h('p',{role:'alert'},error)));
}
export function WorkspaceUnlockControl({client,workspaceId,title}) {
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return h('span',null,h(Button,{size:'sm',onClick:()=>{setOpen(true);setError('');}},'解除工作区锁定'),
    h(Modal,{open,onClose:()=>!busy&&setOpen(false),title:'解除工作区锁定',description:`“${title}”将恢复普通显示，以后新建的聊天也不再自动上锁。此前单独锁定的聊天仍保持锁定。如需删除聊天，请先解除其所有锁定，再回到宿主自行处理；插件不提供删除功能。`,closeLabel:'关闭',footer:h('div',{className:'lc-actions'},h(Button,{variant:'outline',disabled:busy,onClick:()=>setOpen(false)},'取消'),h(Button,{variant:'primary',disabled:busy,onClick:async()=>{setBusy(true);try{await client.setWorkspaceHidden(workspaceId,false);setOpen(false);}catch(e){setError(e.message);}finally{setBusy(false);}}},'解除工作区锁定'))},error&&h('p',{role:'alert'},error)));
}
