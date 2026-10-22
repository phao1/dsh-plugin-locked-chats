/** Version-bounded placement adapter. Only inserts/removes our own portal node.
 * Native nodes, handlers, sorting state and list rendering remain untouched.
 * dsh 0.2.1-rc.2 has no public seat inside the workspace scrolling list.
 */
export function mountWorkspaceEntry(container, onTarget) {
  const target = container.ownerDocument.createElement('div');
  target.dataset.lockedChatsEntry = '';
  target.className = 'lc-sidebar-private';
  const place = () => {
    const root = container.firstElementChild;
    const header = root?.firstElementChild;
    const knownHeader = header && [...header.classList].some(name => /(^|_)sectionHeader(_|$)/.test(name));
    if (!knownHeader) { target.remove(); onTarget(null); return; }
    // Join the native scroll seat, including search/grouped/list views.
    // Only our portal moves; native rows retain their owners and drag handlers.
    const scrollSeat=[...root.querySelectorAll('div')].find(node=>
      [...node.classList].some(name=>/(^|_)list(_|$)/.test(name)));
    if(scrollSeat){if(scrollSeat.firstElementChild!==target)scrollSeat.prepend(target);}
    else if (header.nextElementSibling !== target) header.after(target);
    onTarget(target);
  };
  const Observer = container.ownerDocument.defaultView.MutationObserver;
  const observer = new Observer(place);
  observer.observe(container, { childList: true, subtree: true });
  place();
  return () => { observer.disconnect(); target.remove(); };
}
