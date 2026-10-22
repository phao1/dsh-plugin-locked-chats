/** Reuse live public slot entries without mutating their registrations or importing host source. */
export function composeBrowser(slots, createElement, decorate) {
  const source = 'sidebar.workspaces';
  const prefix = 'locked-chats.composed.';
  const owned = new Set();
  const same = (a, b) => a.length === b.length && a.every((entry, index) => entry === b[index]);

  function mirror(from, to, root = false) {
    let previous = [], disposers = [], stopped = false;
    const clear = () => { for (const dispose of disposers.splice(0).reverse()) dispose(); };
    const sync = () => {
      if (stopped) return;
      const candidates = slots.entriesOfSlot(from).filter(entry => !owned.has(entry.component));
      // At the root our overlay wins; inspect the unchanged original registration instead.
      const entries = root ? slots.entries(from).filter(entry => !owned.has(entry.component)).slice(0, 1) : candidates;
      if (same(previous, entries)) return;
      previous = entries;
      clear();
      for (const entry of entries) {
        const childNames = Object.keys(entry.children ?? {});
        const mapping = Object.fromEntries(childNames.map(key => [key, prefix + key]));
        function Reused(props) {
          const forwarded = { ...props };
          if (childNames.length) {
            forwarded.renderSlot = (key, owner, options) => {
              if (!mapping[key]) throw new Error('Undeclared composed slot: ' + key);
              return props.renderSlot(mapping[key], owner, options);
            };
            if (props.renderSlotChain) forwarded.renderSlotChain = (key, owner, options) => {
              if (!mapping[key]) throw new Error('Undeclared composed chain: ' + key);
              return props.renderSlotChain(mapping[key], owner, options);
            };
          }
          return root ? decorate(entry.component, forwarded) : createElement(entry.component, forwarded);
        }
        owned.add(Reused);
        const options = { name: to, ...entry.options,
          ...(entry.inject ? { inject: entry.inject } : {}),
          ...(entry.store ? { store: entry.store } : {}),
          ...(entry.locale ? { locale: entry.locale } : {}),
          ...(entry.select ? { select: entry.select } : {}),
          ...(childNames.length ? { children: Object.fromEntries(childNames.map(key => [mapping[key], entry.children[key]])) } : {}),
          ...(root ? { priority: -100 } : {}),
        };
        const dispose = slots.register(options, Reused);
        disposers.push(() => { dispose(); owned.delete(Reused); });
        for (const key of childNames) disposers.push(mirror(key, mapping[key]));
      }
    };
    const unsubscribe = slots.subscribe(from, sync);
    sync();
    return () => { stopped = true; unsubscribe(); clear(); };
  }
  return mirror(source, source, true);
}
