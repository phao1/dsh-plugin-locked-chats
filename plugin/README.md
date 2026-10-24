# Locked Chats for dsh

**Keep private chats out of sight. Keep recovery in your hands.** Day 0 for dsh: four-digit PINs, inherited workspace protection, and local recovery files. Reset a forgotten PIN with your saved recovery credential without deleting chats.

[Product overview, screenshots, and Codex comparison](https://github.com/phao1/dsh-plugin-locked-chats/blob/main/README.en.md) · [npm package](https://www.npmjs.com/package/dsh-plugin-locked-chats)

**English** · [简体中文](README.zh-CN.md)

A Web plugin for DeepSeek Harness that keeps selected chats and workspaces out of everyday navigation behind a four-digit PIN. Version **0.1.2** adds declared rc.3 support while retaining rc.2 compatibility and the expired-window reconnection fix from **0.1.1**. It does not require changes to dsh source code.

> This is an application UI privacy feature, not encryption or a security boundary for the underlying chat data.

## Requirements and installation

Compatibility targets: DeepSeek Harness **0.2.1-rc.2 or 0.2.1-rc.3**; other versions are not declared compatible. The current source follows dsh’s English / Simplified Chinese language preference (General settings). Previously distributed packages still use Chinese: this localization update has not been released or published. This documentation is available in both languages. Choose the installation method for your client.

This release is distributed as a GitHub Release tarball; npm `0.1.2` has not been published. Install the URL below directly.

### Desktop

Open **Plugins → Add plugin** in the desktop sidebar and enter this release tarball URL. After installation, choose **Enable now** and restart the app:

```text
https://github.com/phao1/dsh-plugin-locked-chats/releases/download/v0.1.2/dsh-plugin-locked-chats-0.1.2.tgz
```

Alternatively, install with the command provided by the desktop app:

1. Launch the desktop app once and register its command from the application menu: **Manage dsh Command… → Install**.
2. **Fully quit the app** (closing the window keeps it running in the background), then open a new terminal and run:

   ```sh
   dsh plugin --profile desktop add https://github.com/phao1/dsh-plugin-locked-chats/releases/download/v0.1.2/dsh-plugin-locked-chats-0.1.2.tgz
   ```

3. Reopen the desktop app.

Desktop bundles its runtime. For command-line installation, use the desktop-registered `dsh` above; an npm-installed global `dsh` cannot manage the desktop profile. See the [official Desktop guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md).

### Web

Requires **Node.js 24+**. Run:

```sh
dsh plugin --profile web add https://github.com/phao1/dsh-plugin-locked-chats/releases/download/v0.1.2/dsh-plugin-locked-chats-0.1.2.tgz
```

Restart the corresponding dsh profile and refresh the Web interface. Plugin installations in `web` and `desktop` are independent; install into the profile used by your client.


Use a separate plugin data directory for each independent installation. Back up your dsh data and plugin state before testing in production.

## Upgrade from 0.1.0 / 0.1.1

Fully quit Desktop and run the `--profile desktop add` command above with the desktop-registered `dsh`, then reopen the app. For Web, run the `--profile web add` command above, restart the profile, and refresh its page. The same commands replace an earlier local fix package with the release package.

Your chats, PIN, and recovery code are preserved; no credential reset is needed. See the [0.1.2 release notes](CHANGELOG.md).

## Host compatibility policy

The declared range is `0.2.1-rc.2 || 0.2.1-rc.3`. RC plugin interfaces can change, so support is extended after checking interfaces, package installation, and user behavior on each new host version. The plugin does not use `*` or silently waive the host compatibility check. A version outside the range is unverified, not necessarily broken.

Version `0.1.2` passed 71 automated tests in each client-interface environment, build, and typecheck. The package was installed on official rc.2 and rc.3 Web Hosts and verified for locking, PIN unlock, continued chat, search filtering, native views/groups, and persistent drag ordering. Replies used a local synthetic model. Desktop rc.3 still requires user acceptance; Web verification is not Desktop verification.

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

1. Open a chat's menu and choose **Lock chat** (**锁定聊天** in Chinese).
2. On first use, create and confirm a four-digit PIN. Save the recovery code and enter it again to confirm the backup.
3. Open **Locked Chats** (**锁定聊天**) beneath the workspace heading, enter your PIN, and select or create a chat.
4. Use **Lock now** (**立即上锁**) to end the current access session. This keeps the chats protected.

Use **Lock workspace** (**锁定工作区**) in the vault to protect an existing workspace. Unlocking a workspace does not remove locks placed on individual chats. Files, folders, workspace membership, and pinning relationships are not moved.

Since version **0.1.1**, entering your PIN again reconnects an expired window after inactivity or a Host restart. An expired, unfinished credential setup or recovery returns to the start of that operation; your saved PIN, recovery code, and chats remain intact.

**解除锁定** (Remove lock) restores ordinary visibility. For a chat protected through its workspace or parent chat, first remove that inherited protection; an additional individual lock must also be removed. The plugin does **not** provide chat deletion, a recycle bin, or permanent deletion. To manage or delete a chat, remove its locks and use whatever operations the host supports.

## PIN and recovery code

Open **More → Settings → Locked Chats** (**更多 → 设置 → 锁定聊天**) to change the PIN, recover access, or rotate the recovery code.

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

## Interface language (unreleased source)

Settings, PIN/recovery flows, lock/unlock dialogs, errors, previews, and accessibility labels follow the host language without resetting credentials or clearing an open form. User-written chat/workspace titles and messages stay as written. No dsh source changes are needed.

The standalone owner settings page has no client locale service. It uses the browser’s `Accept-Language` preference with English fallback; `?lang=en` or `?lang=zh` selects a language explicitly. Historical product screenshots show isolated Chinese 0.1.0 components, not this update or a full host. See [validation and screenshot limits](https://github.com/phao1/dsh-plugin-locked-chats/blob/fix/english-localization/LOCALIZATION.en.md).
