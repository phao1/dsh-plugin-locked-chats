/** Keep the host menu intact; fit its existing overlay to the vault's top composer. */
export function draftMenuGeometry(card, viewportHeight) {
  const below=Math.max(0,viewportHeight-card.bottom-16);
  const above=Math.max(0,card.top-84-4);
  const downward=below>=Math.min(400,above);
  return {top:downward?`${card.height+4}px`:'auto',bottom:downward?'auto':'calc(100% + 4px)',maxHeight:`${Math.min(400,downward?below:above)}px`};
}

/** Only plugin-owned CSS variables change; native menu options and handlers are retained. */
export function mountDraftMenuLayout(root) {
  if(!root)return()=>{};
  const view=root.ownerDocument.defaultView;
  let card=null;
  const fit=()=>{
    const next=root.querySelector('[data-composer-card]');
    if(next!==card){if(card)resize.unobserve(card);card=next;if(card)resize.observe(card);}
    if(!card)return;
    const geometry=draftMenuGeometry(card.getBoundingClientRect(),view.visualViewport?.height??view.innerHeight);
    root.style.setProperty('--lc-menu-top',geometry.top);
    root.style.setProperty('--lc-menu-bottom',geometry.bottom);
    root.style.setProperty('--lc-menu-max-height',geometry.maxHeight);
  };
  const resize=new view.ResizeObserver(fit);
  const mutation=new view.MutationObserver(fit);
  resize.observe(root);mutation.observe(root,{childList:true,subtree:true});
  view.addEventListener('resize',fit);view.addEventListener('scroll',fit,true);
  view.visualViewport?.addEventListener('resize',fit);
  fit();
  return()=>{
    resize.disconnect();mutation.disconnect();view.removeEventListener('resize',fit);view.removeEventListener('scroll',fit,true);
    view.visualViewport?.removeEventListener('resize',fit);
    for(const key of ['top','bottom','max-height'])root.style.removeProperty(`--lc-menu-${key}`);
  };
}
