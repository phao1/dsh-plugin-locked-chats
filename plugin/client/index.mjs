import { createElement as h, useState, useEffect, useMemo, useRef, useSyncExternalStore, Component } from 'react';
import { createPortal } from 'react-dom';
import { mountWorkspaceEntry } from './entry-placement.mjs';
import { ChatPreview,createChatPreviewLoader } from './chat-preview.mjs';
import { WorkspaceLockControl,WorkspaceUnlockControl } from './vault-controls.mjs';
import { protectedIds,vaultIds,projectWorkspaces,inheritedBy } from './workspace-projection.mjs';
import { composeWorkspacePicker } from './workspace-picker.mjs';
import { PinCells,useAutoVerifyPin } from './pin-input.mjs';
import { CredentialSettings } from './credential-settings.mjs';
import { mountDraftMenuLayout } from './draft-menu-layout.mjs';
import { createDraftPreparer } from './native-draft.mjs';
import { protectPrivateDraftReuse } from './private-draft-reuse.mjs';
import { vaultGroups } from './vault.mjs';
import { PrivacyClient, visibleHits } from './model.mjs';
import { Button, Input, Menu, MenuItemButton, Modal, IconFolderOpenRegular, IconFolderCloseRegular, IconChevronDownOutlineRegular, IconEllipsisOutlineRegular, IconEditOutlineRegular, relativeTime } from '@deepseek-ai/dsh-client-ui-primitives';
import { composeBrowser } from './slot-composition.mjs';
import { hiddenFamily, projectCatalog, preserveHiddenOrder } from './projection.mjs';
import styles from './style.css';
export const inject = ['slots', 'sessions', 'workspaces', 'uiWorkspace', 'layout'];
const PANEL = 'locked-chats';
const LockIcon = ({size = 16}) => h('svg', {width:size, height:size, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:1.5, 'aria-hidden':true}, h('rect',{x:5,y:10,width:14,height:11,rx:3}), h('path',{d:'M8 10V7a4 4 0 0 1 8 0v3M12 14v3',strokeLinecap:'round'}));
const useSource = source => {
  const bound = useMemo(() => ({ subscribe: fn => source.subscribe(fn), get: () => source.getSnapshot() }), [source]);
  return useSyncExternalStore(bound.subscribe, bound.get, bound.get);
};
class HideOnError extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? h('p', { role: 'alert', style: { padding: 16 } }, '锁定聊天界面暂不可用，请刷新。普通列表暂不显示。') : this.props.children; }
}
const button = (text, onClick, props = {}) => h(Button, { type: 'button', onClick, ...props }, text);

/** Reuses the original sidebar and public services; the placement adapter owns only its portal node. */
export function apply(ctx) {
  const client = new PrivacyClient();
  const previews = createChatPreviewLoader(ctx.sessions,()=>client.state.unlocked);
  const currentProtected=()=>protectedIds(ctx.sessions.list.getSnapshot(),client.state,ctx.workspaces.list.getSnapshot().items);
  ctx.effect(() => protectPrivateDraftReuse(ctx.sessions, currentProtected));
  let pendingSession = null;
  let privateOpen = false;
  let alive = true;
  let nativeActions;
  let draftId = null;
  const prepareDraft = createDraftPreparer(client,ctx.sessions);
  const openPanel = () => ctx.layout.selectPanel(PANEL);
  const enterVault = () => { pendingSession = null; if (client.state.unlocked) openPanel(); else client.update({authOpen:true}); };
  const openSession = id => { privateOpen = currentProtected().has(id); ctx.uiWorkspace.openSession(id); };
  const lockNow = async () => { if (privateOpen) { openPanel(); ctx.layout.closeRightbar(); privateOpen = false; } await client.lock(); };
  const startLock = async id => {
    if (ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(id)) throw new Error('请先取消归档，再锁定聊天。');
    pendingSession = id;
    client.update({});
    if (!client.state.unlocked) client.update({authOpen:true});
    if (client.state.unlocked) {
      try { await client.setHidden(id, true); pendingSession = null; await lockNow(); }
      catch (error) {
        if (error.code !== 'access_expired' && error.code !== 'wrong_connection') throw error;
        await client.lock().catch(() => {});
      }
    }
  };
  async function refreshed() { await client.refresh(); }
  void refreshed();
  ctx.effect(() => {
    const timer = setInterval(() => { if (alive) void client.pulse(!document.hidden); }, 15000);
    const visibility = () => { void client.pulse(!document.hidden); };
    const focus = () => { void refreshed(); void client.pulse(true); };
    const unload = () => client.close();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', focus);
    window.addEventListener('pagehide', unload);
    const guardCurrent = () => {
      const rows = ctx.sessions.list.getSnapshot().byId;
      const selectedHidden = [...currentProtected()].some(id => (rows[id]?.retainedBy?.mainView ?? 0) > 0);
      if(!client.state.unlocked)previews.clear();
      if (!client.state.unlocked && (privateOpen || selectedHidden) && ctx.layout.panelInfo.getSnapshot().activePanelId === null) {
        privateOpen = false; openPanel(); ctx.layout.closeRightbar();
      }
    };
    const unsubscribe = client.subscribe(guardCurrent);
    const stopSessions = ctx.sessions.list.subscribe(guardCurrent);
    const stopPanels = ctx.layout.panelInfo.subscribe(guardCurrent);
    const stopWorkspaces = ctx.workspaces.list.subscribe(guardCurrent);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', focus); window.removeEventListener('pagehide', unload); unsubscribe(); stopSessions(); stopPanels(); stopWorkspaces(); previews.dispose(); client.close(); };
  });
  function LockConfirmation() {
    const state = useSource(client);
    const [busy,setBusy]=useState(false), [error,setError]=useState('');
    return h(Modal,{open:!!state.lockRequest,onClose:()=>!busy&&client.update({lockRequest:null}),title:'锁定聊天',description:'此聊天将从普通列表、置顶和搜索中隐藏。你可以在工作区下的“锁定聊天”中找到它。插件记忆按普通／锁定域隔离；已有分享、文件及第三方记忆不受此控制。',closeLabel:'关闭',footer:h('div',{className:'lc-actions'},button('取消',()=>client.update({lockRequest:null}),{disabled:busy}),button('锁定聊天',async()=>{
      setBusy(true);setError('');
      try { await startLock(state.lockRequest); client.update({lockRequest:null}); }
      catch(e){setError(e.message);} finally{setBusy(false);}
    },{variant:'primary',disabled:busy}))},error&&h('p',{role:'alert'},error));
  }
  function LockMenuItem({ sessionId, useMenuOpenState }) {
    const workspaces = useSource(ctx.workspaces.list);
    const [, close] = useMenuOpenState();
    if (workspaces.archivedSessionIds.includes(sessionId)) return null;
    return h(MenuItemButton,{icon:h(LockIcon),onSelect:()=>{close(false);client.update({lockRequest:sessionId});}},'锁定聊天');
  }
  function Row({ row,inherited=false }) {
    const [menu, setMenu] = useState(false), [removing, setRemoving] = useState(false), [busy,setBusy]=useState(false), [error, setError] = useState('');
    const [now,setNow]=useState(Date.now);
    useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer);},[]);
    const time=relativeTime(row.updatedAt||now,now);
    const timeLabel=time.unit==='now'?'刚刚':time.n+({minutes:'分钟',hours:'小时',days:'天',months:'个月',years:'年'}[time.unit]);
    return h('div', { className: 'lc-chat-row' },
      button(h('span',{className:'lc-row-copy'},h('span',{className:'lc-ellipsis'},row.displayTitle),h(ChatPreview,{loader:previews,sessionId:row.id,revision:row.updatedAt,unlocked:client.state.unlocked}),row.updatedAt&&h('span',{className:'lc-row-detail'},timeLabel)), () => openSession(row.id), { className: 'lc-chat-title' }),
      h(Menu, {open:menu,onClose:()=>setMenu(false),portal:true,align:'end',closeOnPointerLeave:true,items:[{id:'rename',label:'重命名',icon:h(IconEditOutlineRegular)},{id:'unlock',label:inherited==='workspace'?'请先解除工作区锁定':inherited?'请先解除父聊天锁定':'解除锁定',icon:h(LockIcon),disabled:!!inherited}],onSelect:id=>{setMenu(false);setError('');if(id==='rename')nativeActions?.requestSessionRename(row.id,row.displayTitle);else if(!inherited)setRemoving(true);},anchor:button(null,()=>setMenu(!menu),{icon:h(IconEllipsisOutlineRegular),size:'sm','aria-label':`会话“${row.displayTitle}”的操作`})}),
      h(Modal, {open:removing,onClose:()=>!busy&&setRemoving(false),title:'解除锁定',description:'此聊天将恢复到普通列表、置顶和搜索中。插件不提供删除功能；如需删除，请解除锁定后回到宿主自行处理。',closeLabel:'关闭',footer:h('div',{className:'lc-actions'},button('取消',()=>setRemoving(false),{variant:'outline',disabled:busy}),button('解除锁定',async()=>{if(busy)return;setBusy(true);setError('');try{await client.setHidden(row.id,false);setRemoving(false);}catch(e){setError(e.message);}finally{setBusy(false);}},{variant:'primary',disabled:busy}))},error && h('p',{role:'alert'},error)));
  }
  function SidebarVaultGroup({group}) {
    const [expanded,setExpanded]=useState(true);
    return h('div',null,
      button(group.title,()=>setExpanded(!expanded),{icon:h(expanded?IconFolderOpenRegular:IconFolderCloseRegular),className:'lc-sidebar-group','aria-expanded':expanded}),
      expanded&&group.rows.map(row=>button(h('span',{className:'lc-ellipsis'},row.displayTitle),()=>openSession(row.id),{key:row.id,className:'lc-sidebar-chat'})));
  }
  function NativeBrowser({ Original, hostProps }) {
    const privacy = useSource(client), catalog = useSource(ctx.sessions.list), workspaces = useSource(ctx.workspaces.list);
    const root = useRef(null), [target,setTarget] = useState(null);
    useEffect(() => privacy.ready ? mountWorkspaceEntry(root.current,setTarget) : undefined, [privacy.ready]);
    const groups = vaultGroups(catalog, vaultIds(catalog,privacy,workspaces.items), workspaces.items,privacy.workspaceIds);
    const hidden = useMemo(() => protectedIds(catalog,privacy,workspaces.items), [catalog, privacy,workspaces.items]);
    const savedOrders = hostProps.useStore(state => state.sessionOrderByAccount);
    useEffect(() => { nativeActions = hostProps; }, [hostProps]);
    const savedRef = useRef(savedOrders); savedRef.current = savedOrders;
    const adapted = useMemo(() => {
      function useVisibleSessions(selector = value => value) {
        const original = hostProps.useSessions(value => value), state = useSource(client), workspaceState=useSource(ctx.workspaces.list);
        const projected = useMemo(() => projectCatalog(original, protectedIds(original,state,workspaceState.items)), [original,state,workspaceState.items]);
        return selector(projected);
      }
      function useVisibleWorkspaces(selector=value=>value){const original=hostProps.useWorkspaces(value=>value),state=useSource(client);const projected=useMemo(()=>projectWorkspaces(original,state),[original,state]);return selector(projected);}
      const preserve = orders => Object.fromEntries(Object.entries(orders).map(([key, ids]) => [key, preserveHiddenOrder(ids, savedRef.current[key] ?? [], currentProtected())]));
      return { ...hostProps, useSessions: useVisibleSessions, useWorkspaces:useVisibleWorkspaces,
        actions: { ...hostProps.actions,
          setSessionOrder: (key, order, initial) => hostProps.actions.setSessionOrder(key, preserve({[key]:order})[key], preserve(initial)),
          syncSessionOrders: orders => hostProps.actions.syncSessionOrders(preserve(orders)),
          setOrderBy: (mode, initial) => hostProps.actions.setOrderBy(mode, preserve(initial)),
        },
      };
    }, [hostProps.useSessions,hostProps.useWorkspaces, hostProps.actions]);
    const searchSessions = useMemo(() => async (query, signal) => {
      const result = await hostProps.searchSessions(query, signal);
      return { ...result, items: visibleHits(result.items, currentProtected()) };
    }, [hostProps.searchSessions, hidden]);
    const entry = button(hostProps.wide ? '锁定聊天' : '', () => { if (!hostProps.wide) hostProps.expandSidebar(); enterVault(); },
      { icon: h(LockIcon), className: 'lc-sidebar-entry', 'aria-label': '锁定聊天' });
    const contents = h('div', null, entry,
      hostProps.wide && privacy.unlocked && h('div',{className:'lc-sidebar-children'},groups.map(group=>h(SidebarVaultGroup,{key:group.id,group}))),
      hostProps.wide && privacy.unlocked && button('立即上锁',()=>{void lockNow();},{size:'sm',className:'lc-sidebar-relock'}));
    return h('section', { className: 'lc-browser', 'aria-label': '项目与聊天' },
      h('div',{ref:root,className:'lc-native-browser'},privacy.ready ? h(Original, { ...hostProps, useSessions: adapted.useSessions,useWorkspaces:adapted.useWorkspaces, actions: adapted.actions, searchSessions }) : h('p', { className: 'lc-status', role: 'status' }, privacy.error || '正在加载…')),
      target ? createPortal(contents,target) : h('div',{className:'lc-entry-fallback'},contents));
  }
  function AuthDialog() {
    const state = useSource(client);
    const [pin,setPin]=useState(''),[confirmation,setConfirmation]=useState(''),[backup,setBackup]=useState(null),[savedCode,setSavedCode]=useState('');
    const [error,setError]=useState(''),[busy,setBusy]=useState(false),[setupStep,setSetupStep]=useState(0);
    const submitting=useRef(false);
    const cancel = async () => {
      if(busy)return;
      if(backup)await client.call('cancel',{operationId:backup.operationId}).catch(()=>{});
      pendingSession=null;setBackup(null);setSavedCode('');setPin('');setConfirmation('');setSetupStep(0);setError('');client.update({authOpen:false});
    };
    useEffect(()=>()=>{if(backup)void client.call('cancel',{operationId:backup.operationId}).catch(()=>{});},[backup]);
    const submit=async event=>{
      event?.preventDefault();if(submitting.current)return;submitting.current=true;setBusy(true);setError('');
      try {
        await client.window();
        if(!state.configured&&!backup&&setupStep===0){if(!/^[0-9]{4}$/.test(pin))throw new Error('请输入 4 位数字 PIN。');setSetupStep(1);return;}
        if(backup){await client.call('confirmBackup',{operationId:backup.operationId,recoveryCode:savedCode});setBackup(null);setSavedCode('');await client.refresh();setPin('');setConfirmation('');}
        else if(!state.configured){setBackup(await client.call('setup',{pin,confirmation}));setPin('');setConfirmation('');}
        else {await client.unlock(pin);setPin('');if(pendingSession){await client.setHidden(pendingSession,true);pendingSession=null;await lockNow();}else openPanel();client.update({authOpen:false});}
      }catch(e){
        if(['wrong_connection','expired_operation','stale_operation','already_configured'].includes(e.code)){
          setBackup(null);setSavedCode('');setPin('');setConfirmation('');setSetupStep(0);await client.refresh();
        }
        setError(e.message);if(state.configured)setPin('');
      }finally{submitting.current=false;setBusy(false);}
    };
    useAutoVerifyPin(pin,!!state.authOpen&&state.configured&&!backup,submit);
    const download=()=>{const url=URL.createObjectURL(new Blob([backup.recoveryCode+'\n'],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download='dsh-locked-chats-recovery.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    return h(Modal,{open:!!state.authOpen,onClose:()=>{void cancel();},title:backup?'保存恢复码':state.configured?'输入 PIN':setupStep?'确认 PIN':'创建 4 位 PIN',description:backup?'恢复码可以无损重设 PIN，请妥善保存。':(state.configured?'输入 4 位 PIN 后自动验证。':'使用同一个 PIN 访问你的所有锁定聊天。'),closeLabel:'关闭'},
      h('form',{onSubmit:submit,className:'lc-pin-form',autoComplete:'off'},
        backup?h('section',null,h(Input,{readOnly:true,value:backup.recoveryCode,'aria-label':'新恢复码',className:'lc-field'}),button('下载恢复文件',download,{disabled:busy}),h('label',null,'回填已保存的恢复码',h(Input,{type:'password',value:savedCode,onChange:e=>setSavedCode(e.target.value),className:'lc-field',required:true,maxLength:256})))
        :h(PinCells,{key:state.configured?'unlock':setupStep,label:!state.configured&&setupStep?'确认 PIN':'PIN',value:!state.configured&&setupStep?confirmation:pin,onChange:!state.configured&&setupStep?setConfirmation:setPin,disabled:busy,allowReveal:!state.configured}),
        error&&h('p',{role:'alert'},error),
        h('div',{className:'lc-actions'},button('取消',cancel,{variant:'outline',disabled:busy}),h(Button,{type:'submit',variant:'primary',disabled:busy},busy?'处理中…':backup?'确认备份':state.configured?'验证':'继续')),
        h('p',{className:'lc-settings-link'},'忘记 PIN？请在“更多 → 设置 → 锁定聊天”中使用恢复码。')));
  }
  function EmptyConversationView() { return null; }
  function NativeDraft({sessionId,useSession,renderFactorySlot}) {
    const session=useSession(value=>value);
    useEffect(()=>{if(session.promptAttempted&&client.state.unlocked){draftId=null;openSession(sessionId);}},[session.promptAttempted,sessionId]);
    return renderFactorySlot('conversation.content',{variant:'embedded',phase:'active',hero:false},{slots:{views:EmptyConversationView}});
  }
  function VaultComposer({SessionProvider,renderSlot}) {
    const composerRoot=useRef(null);
    useEffect(()=>mountDraftMenuLayout(composerRoot.current),[]);
    const workspaces=useSource(ctx.workspaces.list);
    const pickerAnchor=useRef(null),[pickerOpen,setPickerOpen]=useState(false);
    const [workspace,setWorkspace]=useState(workspaces.items[0]?.workspaceId||''),[reference,setReference]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
    useEffect(()=>{if(!workspace&&workspaces.items[0])setWorkspace(workspaces.items[0].workspaceId);},[workspace,workspaces.items]);
    useEffect(()=>{
      if(!workspace)return;
      let active=true,owned=null;
      setReference(null);setError('');
      const catalog=ctx.sessions.list.getSnapshot();
      const members=ctx.workspaces.list.getSnapshot().items.find(w=>w.workspaceId===workspace)?.sessionIds||[];
      const reusable=draftId&&catalog.byId[draftId]?.blank&&members.includes(draftId)?draftId:
        client.state.ids.find(id=>catalog.byId[id]?.blank&&members.includes(id));
      // One creation in flight across StrictMode/re-mounts; each occurrence owns its own reference.
      void prepareDraft(workspace,reusable).then(async sessionId=>{
        if(!active)return;
        draftId=sessionId;
        owned=ctx.sessions.retain(sessionId,{source:'controllerOperation'});
        await owned.ready;
        if(active&&client.state.unlocked)setReference({owned,workspace,retry});
      }).catch(e=>{if(active)setError(e.message);});
      return()=>{active=false;owned?.release();};
    },[workspace,retry]);
    return h('section',{ref:composerRoot,className:'lc-native-composer','aria-label':'新建锁定聊天'},
      h('div',{className:'lc-draft-workspace'},h('span',null,'新建锁定聊天'),
        h(Button,{ref:pickerAnchor,variant:'ghost',icon:h(IconFolderOpenRegular,{size:16}),'aria-label':'新聊天工作区','aria-haspopup':'menu','aria-expanded':pickerOpen,onClick:()=>setPickerOpen(value=>!value)},workspaces.items.find(w=>w.workspaceId===workspace)?.title||'选择工作区',h(IconChevronDownOutlineRegular,{size:12})),
        renderSlot('locked-chats.vault-workspace',{open:pickerOpen,anchorRef:pickerAnchor,selectedId:workspace,onPick:id=>{setPickerOpen(false);setWorkspace(id);},onClose:()=>setPickerOpen(false)})),
      reference?.workspace===workspace&&reference.retry===retry?h(SessionProvider,{key:reference.owned.sessionId,session:reference.owned},renderSlot('locked-chats.native-draft',{})):error?h('div',{role:'alert'},error,button('重试',()=>setRetry(value=>value+1))):h('p',{className:'lc-status'},workspace?'正在准备输入框…':'请先在侧边栏添加工作区。'));
  }
  function PrivatePanel({SessionProvider,renderSlot}) {
    const state = useSource(client), catalog = useSource(ctx.sessions.list), workspaces = useSource(ctx.workspaces.list);
    const [error,setError]=useState('');
    const groups=vaultGroups(catalog,vaultIds(catalog,state,workspaces.items),workspaces.items,state.workspaceIds);
    return h('main', { className: 'lc-panel' },
      h('header',{className:'lc-vault-header'},h('div',{className:'lc-panel-heading'},h(LockIcon,{size:26}),h('h1',null,'锁定聊天')),
        state.unlocked&&h('div',{className:'lc-vault-actions'},h(WorkspaceLockControl,{client,workspaces:workspaces.items,lockedIds:state.workspaceIds,onLocked:lockNow,renderPicker:owner=>renderSlot('locked-chats.lock-workspace',owner)}),button('立即上锁',()=>{void lockNow().catch(e=>setError(e.message));},{icon:h(LockIcon),variant:'outline'}))),
      !state.ready?h('p',{role:'status'},state.error||'正在加载…'):state.unlocked?h('section',{className:'lc-list'},
        h(VaultComposer,{SessionProvider,renderSlot}),
        groups.length===0&&h('div',{className:'lc-empty'},h(LockIcon,{size:32}),h('h2',null,'你的私密对话，从这里开始'),h('p',null,'新建聊天，或在普通聊天菜单中选择“锁定聊天”。')),
        groups.map(group=>h('section',{key:group.id,className:'lc-vault-group','aria-label':group.title},h('h2',null,h(IconFolderOpenRegular),group.title,group.locked&&h(LockIcon),h('span',{className:'lc-group-count'},group.rows.length),group.locked&&h(WorkspaceUnlockControl,{client,workspaceId:group.id,title:group.title})),group.rows.map(row=>h(Row,{key:row.id,row,inherited:inheritedBy(catalog,state,workspaces.items,row.id)})))),
        state.ids.some(id=>!catalog.byId[id])&&h('p',{role:'status'},'部分锁定聊天暂未加载，请刷新会话列表。'))
      :h('div',{className:'lc-empty'},h(LockIcon,{size:40}),h('h2',null,'私密对话，安心收好'),h('p',null,'验证 PIN 后查看锁定的聊天。'),button('打开锁定聊天',()=>client.update({authOpen:true}),{variant:'primary'})),
      error && h('p', { role: 'alert' }, error),
      h('p', { className: 'lc-footnote' }, '界面隐藏不加密原文件。插件记忆按普通／锁定域隔离；第三方记忆与已有分享不受此控制。'));
  }
  function PrivateHeader({sessionId}) {
    const state=useSource(client),catalog=useSource(ctx.sessions.list);
    if(!state.unlocked||!currentProtected().has(sessionId))return null;
    return h('div',{className:'lc-private-header'},button('锁定聊天',openPanel,{icon:h(LockIcon),size:'sm','aria-label':'返回锁定聊天'}),button('立即上锁',()=>{void lockNow();},{size:'sm'}));
  }
  ctx.slots.inject('conversation.session.header.utilities',()=>ctx.slots.register({name:'conversation.session.header.utilities',id:'locked-chats.navigation',order:-50,inject:sessionId=>({sessionId})},PrivateHeader));
  ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'locked-chats.auth',order:510},AuthDialog));
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({name:'shell.overlay',id:'locked-chats.confirm',order:500},LockConfirmation));
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL,children:{'locked-chats.native-draft':{kind:'single',scope:'session'},'locked-chats.vault-workspace':{kind:'single',scope:'root'},'locked-chats.lock-workspace':{kind:'single',scope:'root'}} }, PrivatePanel));
  ctx.slots.inject('locked-chats.native-draft',()=>ctx.slots.register({name:'locked-chats.native-draft'},NativeDraft));
  ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'locked-chats',order:65,label:()=> '锁定聊天'},()=>h(CredentialSettings,{onChanged:async()=>{await client.lock();await client.refresh();}})));
  ctx.effect(() => { const tag = document.createElement('style'); tag.textContent = styles; document.head.appendChild(tag); return () => tag.remove(); });
  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({ name: 'sidebar.workspaces.session.menu.item', id: 'locked-chats.lock', order: 250 }, LockMenuItem));
  ctx.slots.inject('conversation.hero.workspace',()=>composeWorkspacePicker(ctx.slots,client));
  ctx.slots.inject('locked-chats.vault-workspace',()=>composeWorkspacePicker(ctx.slots,client,{target:'locked-chats.vault-workspace',vault:true}));
  ctx.slots.inject('locked-chats.lock-workspace',()=>composeWorkspacePicker(ctx.slots,client,{target:'locked-chats.lock-workspace',vault:true,lockSelection:true}));
  ctx.slots.inject('sidebar.workspaces', () => composeBrowser(ctx.slots, h, (Original, hostProps) => h(HideOnError, null, h(NativeBrowser, { Original, hostProps }))));
}
