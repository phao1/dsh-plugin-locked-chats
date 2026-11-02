import {installLocalization,messageText,useTranslation,TranslationContext} from './localization.mjs';
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
export const inject = ['slots', 'sessions', 'workspaces', 'uiWorkspace', 'layout', 'locale'];
const PANEL = 'locked-chats';
const LockIcon = ({size = 16}) => h('svg', {width:size, height:size, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:1.5, 'aria-hidden':true}, h('rect',{x:5,y:10,width:14,height:11,rx:3}), h('path',{d:'M8 10V7a4 4 0 0 1 8 0v3M12 14v3',strokeLinecap:'round'}));
const useSource = source => {
  const bound = useMemo(() => ({ subscribe: fn => source.subscribe(fn), get: () => source.getSnapshot() }), [source]);
  return useSyncExternalStore(bound.subscribe, bound.get, bound.get);
};
class HideOnError extends Component {
  static contextType = TranslationContext;
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? h('p', { role: 'alert', style: { padding: 16 } }, this.context("uiUnavailable")) : this.props.children; }
}
const button = (text, onClick, props = {}) => h(Button, { type: 'button', onClick, ...props }, text);

/** Reuses the original sidebar and public services; the placement adapter owns only its portal node. */
export function apply(ctx) {
  const {t,wrap,Localized}=installLocalization(ctx);
  const client = new PrivacyClient(undefined,t);
  const previews = createChatPreviewLoader(ctx.sessions,()=>client.state.unlocked,t);
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
    if (ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(id)) throw Object.assign(new Error(t('unarchiveFirst')),{key:'unarchiveFirst'});
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
    const t=useTranslation();
    const state = useSource(client);
    const [busy,setBusy]=useState(false), [error,setError]=useState('');
    return h(Modal,{open:!!state.lockRequest,onClose:()=>!busy&&client.update({lockRequest:null}),title:t("lockChat"),description:t("lockChatDescription"),closeLabel:t("close"),footer:h('div',{className:'lc-actions'},button(t("cancel"),()=>client.update({lockRequest:null}),{disabled:busy}),button(t("lockChat"),async()=>{
      setBusy(true);setError('');
      try { await startLock(state.lockRequest); client.update({lockRequest:null}); }
      catch(e){setError(e);} finally{setBusy(false);}
    },{variant:'primary',disabled:busy}))},error&&h('p',{role:'alert'},messageText(error,t)));
  }
  function LockMenuItem({ sessionId, useMenuOpenState }) {
    const t=useTranslation();
    const workspaces = useSource(ctx.workspaces.list);
    const [, close] = useMenuOpenState();
    if (workspaces.archivedSessionIds.includes(sessionId)) return null;
    return h(MenuItemButton,{icon:h(LockIcon),onSelect:()=>{close(false);client.update({lockRequest:sessionId});}},t("lockChat"));
  }
  function Row({ row,inherited=false }) {
    const t=useTranslation();
    const [menu, setMenu] = useState(false), [removing, setRemoving] = useState(false), [busy,setBusy]=useState(false), [error, setError] = useState('');
    const [now,setNow]=useState(Date.now);
    useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer);},[]);
    const time=relativeTime(row.updatedAt||now,now);
    const timeLabel=time.unit==='now'?t('now'):t(`time.${time.unit}.${time.n===1?'one':'other'}`,{count:time.n});
    return h('div', { className: 'lc-chat-row' },
      button(h('span',{className:'lc-row-copy'},h('span',{className:'lc-ellipsis'},row.displayTitle),h(ChatPreview,{loader:previews,sessionId:row.id,revision:row.updatedAt,unlocked:client.state.unlocked}),row.updatedAt&&h('span',{className:'lc-row-detail'},timeLabel)), () => openSession(row.id), { className: 'lc-chat-title' }),
      h(Menu, {open:menu,onClose:()=>setMenu(false),portal:true,align:'end',closeOnPointerLeave:true,items:[{id:'rename',label:t("rename"),icon:h(IconEditOutlineRegular)},{id:'unlock',label:inherited==='workspace'?t("unlockWorkspaceFirst"):inherited?t("unlockParentFirst"):t("unlockChat"),icon:h(LockIcon),disabled:!!inherited}],onSelect:id=>{setMenu(false);setError('');if(id==='rename')nativeActions?.requestSessionRename(row.id,row.displayTitle);else if(!inherited)setRemoving(true);},anchor:button(null,()=>setMenu(!menu),{icon:h(IconEllipsisOutlineRegular),size:'sm','aria-label':t('chatActions',{title:row.displayTitle})})}),
      h(Modal, {open:removing,onClose:()=>!busy&&setRemoving(false),title:t("unlockChat"),description:t("unlockChatDescription"),closeLabel:t("close"),footer:h('div',{className:'lc-actions'},button(t("cancel"),()=>setRemoving(false),{variant:'outline',disabled:busy}),button(t("unlockChat"),async()=>{if(busy)return;setBusy(true);setError('');try{await client.setHidden(row.id,false);setRemoving(false);}catch(e){setError(e);}finally{setBusy(false);}},{variant:'primary',disabled:busy}))},error && h('p',{role:'alert'},messageText(error,t))));
  }
  function SidebarVaultGroup({group}) {
    const [expanded,setExpanded]=useState(true);
    return h('div',null,
      button(group.title,()=>setExpanded(!expanded),{icon:h(expanded?IconFolderOpenRegular:IconFolderCloseRegular),className:'lc-sidebar-group','aria-expanded':expanded}),
      expanded&&group.rows.map(row=>button(h('span',{className:'lc-ellipsis'},row.displayTitle),()=>openSession(row.id),{key:row.id,className:'lc-sidebar-chat'})));
  }
  function NativeBrowser({ Original, hostProps }) {
    const t=useTranslation();
    const privacy = useSource(client), catalog = useSource(ctx.sessions.list), workspaces = useSource(ctx.workspaces.list);
    const root = useRef(null), [target,setTarget] = useState(null);
    useEffect(() => privacy.ready ? mountWorkspaceEntry(root.current,setTarget) : undefined, [privacy.ready]);
    const groups = vaultGroups(catalog, vaultIds(catalog,privacy,workspaces.items), workspaces.items,privacy.workspaceIds,t);
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
    const entry = button(hostProps.wide ? t("lockedChats") : '', () => { if (!hostProps.wide) hostProps.expandSidebar(); enterVault(); },
      { icon: h(LockIcon), className: 'lc-sidebar-entry', 'aria-label': t("lockedChats") });
    const contents = h('div', null, entry,
      hostProps.wide && privacy.unlocked && h('div',{className:'lc-sidebar-children'},groups.map(group=>h(SidebarVaultGroup,{key:group.id,group}))),
      hostProps.wide && privacy.unlocked && button(t("lockNow"),()=>{void lockNow();},{size:'sm',className:'lc-sidebar-relock'}));
    return h('section', { className: 'lc-browser', 'aria-label': t("projectsAndChats") },
      h('div',{ref:root,className:'lc-native-browser'},privacy.ready ? h(Original, { ...hostProps, useSessions: adapted.useSessions,useWorkspaces:adapted.useWorkspaces, actions: adapted.actions, searchSessions }) : h('p', { className: 'lc-status', role: 'status' }, messageText(privacy.error,t) || t("loading"))),
      target ? createPortal(contents,target) : h('div',{className:'lc-entry-fallback'},contents));
  }
  function AuthDialog() {
    const t=useTranslation();
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
        if(!state.configured&&!backup&&setupStep===0){if(!/^[0-9]{4}$/.test(pin))throw Object.assign(new Error(t('enterFourDigits')),{key:'enterFourDigits'});setSetupStep(1);return;}
        if(backup){await client.call('confirmBackup',{operationId:backup.operationId,recoveryCode:savedCode});setBackup(null);setSavedCode('');await client.refresh();setPin('');setConfirmation('');}
        else if(!state.configured){setBackup(await client.call('setup',{pin,confirmation}));setPin('');setConfirmation('');}
        else {await client.unlock(pin);setPin('');if(pendingSession){await client.setHidden(pendingSession,true);pendingSession=null;await lockNow();}else openPanel();client.update({authOpen:false});}
      }catch(e){
        if(['wrong_connection','expired_operation','stale_operation','already_configured'].includes(e.code)){
          setBackup(null);setSavedCode('');setPin('');setConfirmation('');setSetupStep(0);await client.refresh();
        }
        setError(e);if(state.configured)setPin('');
      }finally{submitting.current=false;setBusy(false);}
    };
    useAutoVerifyPin(pin,!!state.authOpen&&state.configured&&!backup,submit);
    const download=()=>{const url=URL.createObjectURL(new Blob([backup.recoveryCode+'\n'],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download='dsh-locked-chats-recovery.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    return h(Modal,{open:!!state.authOpen,onClose:()=>{void cancel();},title:backup?t("saveRecovery"):state.configured?t("enterPin"):setupStep?t("confirmPin"):t("createPin"),description:backup?t("recoveryDescription"):(state.configured?t("autoVerifyDescription"):t("sharedPinDescription")),closeLabel:t("close")},
      h('form',{onSubmit:submit,className:'lc-pin-form',autoComplete:'off'},
        backup?h('section',null,h(Input,{readOnly:true,value:backup.recoveryCode,'aria-label':t("newRecovery"),className:'lc-field'}),button(t("downloadRecovery"),download,{disabled:busy}),h('label',null,t("reenterRecovery"),h(Input,{type:'password',value:savedCode,onChange:e=>setSavedCode(e.target.value),className:'lc-field',required:true,maxLength:256})))
        :h(PinCells,{key:state.configured?'unlock':setupStep,label:!state.configured&&setupStep?t("confirmPin"):'PIN',value:!state.configured&&setupStep?confirmation:pin,onChange:!state.configured&&setupStep?setConfirmation:setPin,disabled:busy,allowReveal:!state.configured}),
        error&&h('p',{role:'alert'},messageText(error,t)),
        h('div',{className:'lc-actions'},button(t("cancel"),cancel,{variant:'outline',disabled:busy}),h(Button,{type:'submit',variant:'primary',disabled:busy},busy?t("processing"):backup?t("confirmBackup"):state.configured?t("verify"):t("continue"))),
        h('p',{className:'lc-settings-link'},t("forgotPinHelp"))));
  }
  function EmptyConversationView() { return null; }
  function NativeDraft({sessionId,useSession,renderFactorySlot}) {
    const session=useSession(value=>value);
    useEffect(()=>{if(session.promptAttempted&&client.state.unlocked){draftId=null;openSession(sessionId);}},[session.promptAttempted,sessionId]);
    return renderFactorySlot('conversation.content',{variant:'embedded',phase:'active',hero:false},{slots:{views:EmptyConversationView}});
  }
  function VaultComposer({SessionProvider,renderSlot}) {
    const t=useTranslation();
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
      }).catch(e=>{if(active)setError(e);});
      return()=>{active=false;owned?.release();};
    },[workspace,retry]);
    return h('section',{ref:composerRoot,className:'lc-native-composer','aria-label':t("newLockedChat")},
      h('div',{className:'lc-draft-workspace'},h('span',null,t("newLockedChat")),
        h(Button,{ref:pickerAnchor,variant:'ghost',icon:h(IconFolderOpenRegular,{size:16}),'aria-label':t("newChatWorkspace"),'aria-haspopup':'menu','aria-expanded':pickerOpen,onClick:()=>setPickerOpen(value=>!value)},workspaces.items.find(w=>w.workspaceId===workspace)?.title||t("chooseWorkspace"),h(IconChevronDownOutlineRegular,{size:12})),
        renderSlot('locked-chats.vault-workspace',{open:pickerOpen,anchorRef:pickerAnchor,selectedId:workspace,onPick:id=>{setPickerOpen(false);setWorkspace(id);},onClose:()=>setPickerOpen(false)})),
      reference?.workspace===workspace&&reference.retry===retry?h(SessionProvider,{key:reference.owned.sessionId,session:reference.owned},renderSlot('locked-chats.native-draft',{})):error?h('div',{role:'alert'},messageText(error,t),button(t("retry"),()=>setRetry(value=>value+1))):h('p',{className:'lc-status'},workspace?t("preparingComposer"):t("addWorkspaceFirst")));
  }
  function PrivatePanel({SessionProvider,renderSlot}) {
    const t=useTranslation();
    const state = useSource(client), catalog = useSource(ctx.sessions.list), workspaces = useSource(ctx.workspaces.list);
    const [error,setError]=useState('');
    const groups=vaultGroups(catalog,vaultIds(catalog,state,workspaces.items),workspaces.items,state.workspaceIds,t);
    return h('main', { className: 'lc-panel' },
      h('header',{className:'lc-vault-header'},h('div',{className:'lc-panel-heading'},h(LockIcon,{size:26}),h('h1',null,t("lockedChats"))),
        state.unlocked&&h('div',{className:'lc-vault-actions'},h(WorkspaceLockControl,{client,workspaces:workspaces.items,lockedIds:state.workspaceIds,onLocked:lockNow,renderPicker:owner=>renderSlot('locked-chats.lock-workspace',owner)}),button(t("lockNow"),()=>{void lockNow().catch(e=>setError(e));},{icon:h(LockIcon),variant:'outline'}))),
      !state.ready?h('p',{role:'status'},messageText(state.error,t)||t("loading")):state.unlocked?h('section',{className:'lc-list'},
        h(VaultComposer,{SessionProvider,renderSlot}),
        groups.length===0&&h('div',{className:'lc-empty'},h(LockIcon,{size:32}),h('h2',null,t("startPrivateChats")),h('p',null,t("startPrivateDescription"))),
        groups.map(group=>h('section',{key:group.id,className:'lc-vault-group','aria-label':group.title},h('h2',null,h(IconFolderOpenRegular),group.title,group.locked&&h(LockIcon),h('span',{className:'lc-group-count'},group.rows.length),group.locked&&h(WorkspaceUnlockControl,{client,workspaceId:group.id,title:group.title})),group.rows.map(row=>h(Row,{key:row.id,row,inherited:inheritedBy(catalog,state,workspaces.items,row.id)})))),
        state.ids.some(id=>!catalog.byId[id])&&h('p',{role:'status'},t("chatsNotLoaded")))
      :h('div',{className:'lc-empty'},h(LockIcon,{size:40}),h('h2',null,t("privateChatsTitle")),h('p',null,t("verifyToView")),button(t("openLockedChats"),()=>client.update({authOpen:true}),{variant:'primary'})),
      error && h('p', { role: 'alert' }, messageText(error,t)),
      h('p', { className: 'lc-footnote' }, t("vaultFootnote")));
  }
  function PrivateHeader({sessionId}) {
    const t=useTranslation();
    const state=useSource(client),catalog=useSource(ctx.sessions.list);
    if(!state.unlocked||!currentProtected().has(sessionId))return null;
    return h('div',{className:'lc-private-header'},button(t("lockedChats"),openPanel,{icon:h(LockIcon),size:'sm','aria-label':t("backToLockedChats")}),button(t("lockNow"),()=>{void lockNow();},{size:'sm'}));
  }
  ctx.slots.inject('conversation.session.header.utilities',()=>ctx.slots.register({name:'conversation.session.header.utilities',id:'locked-chats.navigation',order:-50,inject:sessionId=>({sessionId})},wrap(PrivateHeader)));
  ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'locked-chats.auth',order:510},wrap(AuthDialog)));
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({name:'shell.overlay',id:'locked-chats.confirm',order:500},wrap(LockConfirmation)));
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL,children:{'locked-chats.native-draft':{kind:'single',scope:'session'},'locked-chats.vault-workspace':{kind:'single',scope:'root'},'locked-chats.lock-workspace':{kind:'single',scope:'root'}} }, wrap(PrivatePanel)));
  ctx.slots.inject('locked-chats.native-draft',()=>ctx.slots.register({name:'locked-chats.native-draft'},NativeDraft));
  ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'locked-chats',order:65,label:()=> t("lockedChats")},wrap(()=>h(CredentialSettings,{onChanged:async()=>{await client.lock();await client.refresh();}}))));
  ctx.effect(() => { const tag = document.createElement('style'); tag.textContent = styles; document.head.appendChild(tag); return () => tag.remove(); });
  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({ name: 'sidebar.workspaces.session.menu.item', id: 'locked-chats.lock', order: 250 }, wrap(LockMenuItem)));
  ctx.slots.inject('conversation.hero.workspace',()=>composeWorkspacePicker(ctx.slots,client));
  ctx.slots.inject('locked-chats.vault-workspace',()=>composeWorkspacePicker(ctx.slots,client,{target:'locked-chats.vault-workspace',vault:true}));
  ctx.slots.inject('locked-chats.lock-workspace',()=>composeWorkspacePicker(ctx.slots,client,{target:'locked-chats.lock-workspace',vault:true,lockSelection:true}));
  ctx.slots.inject('sidebar.workspaces', () => composeBrowser(ctx.slots, h, (Original, hostProps) => h(Localized,null,h(HideOnError, {t}, h(NativeBrowser, { Original, hostProps })))));
}
