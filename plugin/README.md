# Locked Chats for dsh

**Keep private chats out of sight. Keep recovery in your hands.** Day 0 for dsh: four-digit PINs, inherited workspace protection, and local recovery files. Reset a forgotten PIN with your saved recovery credential without deleting chats.

[Product overview, screenshots, and Codex comparison](https://github.com/phao1/dsh-plugin-locked-chats/blob/main/README.en.md) · [npm package](https://www.npmjs.com/package/dsh-plugin-locked-chats)

**English** · [简体中文](README.zh-CN.md)

A Web plugin for DeepSeek Harness that keeps selected chats and workspaces out of everyday navigation behind a four-digit PIN. Version **0.1.0** is the first release. It does not require changes to dsh source code.

> This is an application UI privacy feature, not encryption or a security boundary for the underlying chat data.

## Requirements and installation

- Node.js **24 or later**.
- DeepSeek Harness **0.2.1-rc.2**; other versions have not been verified.
- The dsh Web interface. The plugin UI currently uses Chinese; this documentation is available in both languages.

```sh
dsh plugin --profile web add dsh-plugin-locked-chats@0.1.0
```

Restart the corresponding dsh profile and refresh its Web page. Use a separate plugin data directory for each independent installation. Back up your dsh data and plugin state before testing in production.

## Features

- Lock individual chats from the native chat menu, or lock an entire workspace from the vault.
- Hide protected chats from ordinary history, pinned items, and supported search results. A locked workspace also protects its existing and future chats and descendants.
- Browse protected chats by workspace, view recent text previews, and continue chatting using the native dsh conversation UI.
- Reuse native input, attachment, model, permission, command, menu, and dialog components. Keep native sidebar views, search, drag-and-drop, and sorting.
- Scroll locked and ordinary navigation together beneath the fixed workspace heading.
- Automatically verify a completed four-digit PIN. Show the new PIN when creating or changing it to help prevent typing mistakes.
- Recover access with a separately saved recovery code, without deleting chats.
- Separate ordinary and private memory entries within the plugin's own memory tool.

## Using the vault

1. Open a chat's menu and choose **锁定聊天** (Lock chat).
2. On first use, create and confirm a four-digit PIN. Save the recovery code and enter it again to confirm the backup.
3. Open **锁定聊天** beneath the workspace heading, enter your PIN, and select or create a chat.
4. Use **立即上锁** (Lock now) to end the current access session. This keeps the chats protected.

Use **锁定工作区** (Lock workspace) in the vault to protect an existing workspace. Unlocking a workspace does not remove locks placed on individual chats. Files, folders, workspace membership, and pinning relationships are not moved.

**解除锁定** (Remove lock) restores ordinary visibility. For a chat protected through its workspace or parent chat, first remove that inherited protection; an additional individual lock must also be removed. The plugin does **not** provide chat deletion, a recycle bin, or permanent deletion. To manage or delete a chat, remove its locks and use whatever operations the host supports.

## PIN and recovery code

Open **更多 → 设置 → 锁定聊天** (More → Settings → Locked chats) to change the PIN, recover access, or rotate the recovery code.

The recovery code can reset a forgotten PIN without deleting chats. Save it separately from the application; it is an access credential, not a chat backup. The plugin does not save a plaintext copy by default. If both PIN and recovery code are lost, the plugin has no credential-free recovery flow.

By default, five failed attempts trigger a 60-second cooldown. Each subsequent batch of five failures doubles the cooldown, up to 15 minutes; successful verification resets it. PIN and recovery-code checks are rate-limited separately. Counters survive refreshes and restarts, and failed attempts never delete chats.

## Memory behavior

The native model tool `locked_chats_memory` supports `remember`, `search`, and `forget`. Ask the model explicitly to save or forget a memory; this is not automatic extraction of every conversation.

| Chat state | Reads | Writes, updates, and forgets |
| --- | --- | --- |
| Ordinary | Ordinary memory | Ordinary memory |
| Locked | Ordinary and private memory | Private memory |

Permissions come from the actual session, workspace, and ancestor lock state. The model cannot choose another session or memory scope. Unknown session ancestry is rejected.

Locking a chat does not erase earlier ordinary memories. Removing a lock does not move existing private memories into ordinary memory. Forgetting a memory removes only that plugin memory entry, not a chat.

## Protection limits

- UI hiding does not encrypt logs, attachments, files, or plugin storage.
- Direct APIs, CLI access, file tools, other clients, third-party search or references, and disabling or uninstalling the plugin can bypass this UI protection.
- Memory separation applies only to `locked_chats_memory`. It does not control third-party MCP memory, files, `AGENTS.md`, provider-side memory, or other cross-chat references.
- Existing shares are not revoked. Other open windows may need a refresh.
- The plugin does not change model-training or retention settings.
- File access protection, account synchronization, mobile biometrics, and complete background-task eligibility restrictions are not implemented.
- Recovery-code reset intentionally preserves chats rather than reproducing ChatGPT's destructive reset behavior.

The workspace-entry placement adapter targets the supported host layout. When that structure is not recognized, it falls back to the browsing area's entry location. The original sidebar rows and handlers remain owned by dsh.

## Development

From this repository's `plugin` directory:

```sh
npm ci
npm run build
npm run typecheck
npm test
```

Build, typecheck, and unit tests use published dependencies and do not require a host source checkout. Optional host integration scripts require a compatible isolated test host. The installed npm package does not require a host source checkout. Runtime state, credentials, test fixtures, and local test servers are not part of the package.

[Release notes](CHANGELOG.md)

## License

[MIT](LICENSE) © 2026 Hao Peng.
