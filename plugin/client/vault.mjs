/** Group only explicitly locked chats; workspace membership itself is unchanged. */
export function vaultGroups(catalog, ids, workspaces, lockedWorkspaceIds=[]) {
  const remaining = new Set(ids.filter(id => catalog.byId[id] && !catalog.byId[id].blank));
  const groups = [];
  for (const workspace of workspaces) {
    const members = workspace.sessionIds.filter(id => remaining.has(id));
    if (!members.length&&!lockedWorkspaceIds.includes(workspace.workspaceId)) continue;
    members.forEach(id => remaining.delete(id));
    groups.push({ id: workspace.workspaceId, title: workspace.title || workspace.path, ...(lockedWorkspaceIds.includes(workspace.workspaceId)?{locked:true}:{}), rows: members.map(id => catalog.byId[id]).filter(Boolean) });
  }
  const rows = [...remaining].map(id => catalog.byId[id]).filter(Boolean);
  if (rows.length) groups.push({ id: '', title: '独立聊天', rows });
  return groups;
}
