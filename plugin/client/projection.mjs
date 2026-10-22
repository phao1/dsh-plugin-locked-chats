/** Exclude a hidden root's subagents as well, so expanded native trees cannot reveal them. */
export function hiddenFamily(catalog, ids) {
  const hidden = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of Object.values(catalog.byId)) {
      if (hidden.has(row.parentId) && !hidden.has(row.id)) { hidden.add(row.id); changed = true; }
    }
  }
  return hidden;
}
export function projectCatalog(catalog, hidden) {
  return { ...catalog, ids: catalog.ids.filter(id => !hidden.has(id)),
    byId: Object.fromEntries(Object.entries(catalog.byId).filter(([id]) => !hidden.has(id))),
    projectionsBySession: Object.fromEntries(Object.entries(catalog.projectionsBySession ?? {}).filter(([id]) => !hidden.has(id))) };
}
/** Visible drag operations must not erase the saved positions of hidden chats. */
export function preserveHiddenOrder(next, previous, hidden) {
  const result = [...next];
  previous.forEach((id, index) => {
    if (hidden.has(id) && !result.includes(id)) result.splice(Math.min(index, result.length), 0, id);
  });
  return result;
}
