/** Keep native named-draft reuse from consuming a vault-owned blank. */
export function protectPrivateDraftReuse(sessions, protectedIds) {
  const original = sessions.create;
  let active = true;
  function create(request) {
    const id = request?.sessionId;
    // Vault reservations are hidden before first creation, but are not yet in
    // the catalog. Only an existing blank offered for native reuse is rerouted.
    // The original request (preset, migration options, etc.) remains host-owned.
    if (active && id && sessions.list.getSnapshot().byId[id]?.blank && protectedIds().has(id)) {
      return original.call(this, { ...request, sessionId: crypto.randomUUID() });
    }
    return original.call(this, request);
  }
  sessions.create = create;
  return () => { active = false; if (sessions.create === create) sessions.create = original; };
}
