# Changelog / 版本说明

[English documentation](README.md) · [中文文档](README.zh-CN.md)

## 0.1.3 — 2026-10-25 — English and Chinese UI / 中英文界面

### English

- Follow the native dsh locale service for English and Simplified Chinese settings, navigation, PIN/recovery, lock/unlock dialogs, API errors, previews, relative times, and accessibility labels.
- Preserve open PIN/recovery forms and translate already visible status/error messages when the language changes; keep user-authored titles and text unchanged.
- Localize the standalone owner settings page using a supported language query or browser preference, with English fallback. Correct its outdated memory-isolation description.
- Add current English screenshots from real isolated rc.2/rc.3 Web Hosts. Preserve the 0.1.0 component screenshots as historical examples. Keep one-click updating deferred.

Validation: 77 tests per rc.2/rc.3 environment, typecheck/build, and real Web Host package-upgrade checks for English settings, original-PIN unlock and continued chat. rc.3 additionally covers locking, search, views/groups and drag persistence. Desktop remains unverified. GitHub tarball release; npm 0.1.3 is not published. See [release acceptance](https://github.com/phao1/dsh-plugin-locked-chats/blob/v0.1.3/RELEASE-0.1.3.en.md).

### 简体中文

- 通过 dsh 原生语言服务提供 English / 简体中文设置、导航、PIN/恢复、锁定/解锁弹窗、API 错误、摘要占位符、相对时间及无障碍标签。
- 切换语言时保留已打开的 PIN/恢复表单，并翻译已显示的状态/错误消息；用户自行填写的标题及正文保持原文。
- 独立的所有者设置页面通过支持的语言查询参数或浏览器偏好选语言，默认回退英文；修正其中已过时的记忆隔离说明。
- 补充 rc.2/rc.3 真实隔离 Web 宿主英文截图，保留 0.1.0 中文组件截图作为历史示例。一键升级继续搁置。

验证：rc.2/rc.3 各 77 项测试、类型检查/构建，以及真实 Web 宿主安装包升级后的英文设置、原 PIN 解锁和继续聊天；rc.3 另覆盖锁定、搜索、视图/分组和拖拽持久化。桌面端仍未验收。交付 GitHub tarball；npm 0.1.3 未发布。详见[发布验收](https://github.com/phao1/dsh-plugin-locked-chats/blob/v0.1.3/RELEASE-0.1.3.zh-CN.md)。

## 0.1.2 — 2026-10-24 — DSH rc.3 compatibility / DSH rc.3 兼容

### English

- Explicitly declare support for dsh `0.2.1-rc.2` and `0.2.1-rc.3`, retaining support for the earlier host and the window reconnection fix from 0.1.1.
- Prevent native New Session from reusing a vault-owned blank draft on rc.3, keeping native navigation and composer behavior intact.
- Document the compatibility policy: extend the declared RC range after interface, installation, and behavior checks instead of claiming all future versions with `*`.
- Update Desktop and Web installation and upgrade instructions. No dsh source changes or credential reset are required.

Validation: 71 automated tests per rc.2/rc.3 interface environment, build/typecheck, official rc.2/rc.3 Web Host package installation, and browser checks for locking, PIN unlock, continued chat, normal New Session, search filtering, native views/groups, and persistent drag ordering. Replies used a local synthetic model. Desktop rc.3 remains for user acceptance. GitHub Release tarball only; npm 0.1.2 is not published.

### 简体中文

- 显式声明支持 dsh `0.2.1-rc.2` 与 `0.2.1-rc.3`，保留旧宿主支持及 0.1.1 的窗口重连修复。
- 修复 rc.3 原生新建会话可能复用保险箱隐藏草稿、导致跳回保险箱的问题，保留原生导航和输入框行为。
- 说明兼容范围策略：通过接口、安装和行为验证后再扩大 RC 支持范围，不使用 `*` 声称兼容所有未来版本。
- 更新桌面端、Web 端安装及升级说明，无需修改 dsh 源码或重设凭据。

验证：rc.2/rc.3 接口环境各 71 项自动化测试、构建/类型检查、两版官方 Web 宿主安装包验收，以及锁定、PIN 解锁、继续聊天、普通新建、搜索过滤、原生视图/分组和拖拽持久化浏览器检查通过。回复使用本地合成模型。桌面端 rc.3 留待用户验收。本轮仅发布 GitHub Release 安装包，npm 0.1.2 未发布。

## 0.1.1 — 2026-10-23 — Window reconnection fix / 窗口重连修复

### English

- Re-establish expired window connections during fresh PIN or recovery verification, including after a Host restart, without requiring a page refresh.
- Clear obsolete access and pending credential forms; expired backups must be restarted, and protected writes are never automatically replayed.
- Discard late window and unlock responses after closing or locking the client.
- Document Desktop and Web installation and upgrades; preserve existing chats and credentials.

Validation: 69 tests, build, and typecheck passed. The fix was exercised on an isolated real dsh Web Host and confirmed by the user in Desktop 0.2.1-rc.2.

### 简体中文

- 输入 PIN 或恢复码重新验证时自动重建失效的窗口连接，支持闲置过期及 Host 重启后的恢复，无需刷新页面。
- 清理失效授权及未完成的凭据表单；过期备份需重新开始，受保护的写操作不会自动重试。
- 关闭或上锁后丢弃迟到的窗口创建及解锁响应。
- 补全文档中的桌面端及 Web 安装和升级步骤，保留现有聊天及凭据。

验证：69 项测试、构建和类型检查通过；修复已在独立的真实 dsh Web 服务中验证，用户已在桌面端 0.2.1-rc.2 确认正常解锁。

## 0.1.0 — First release / 首个版本

### English

- Add a four-digit PIN vault for chats and entire workspaces, with automatic PIN verification and non-destructive recovery codes.
- Hide protected entries from supported ordinary navigation and search while preserving native dsh conversation controls, sidebar views, and sorting.
- Provide workspace-grouped previews, inherited workspace/parent protection, and shared sidebar scrolling.
- Separate ordinary and private memories in the plugin-owned memory tool.
- Provide lock removal only; no chat deletion, recycle bin, or permanent deletion.
- Publish linked English and Simplified Chinese documentation.

This release targets dsh 0.2.1-rc.2 Web and Node.js 24+. It provides UI hiding, not encryption or comprehensive access control. See the README for supported behavior and limitations.

### 简体中文

- 为聊天和整个工作区提供四位 PIN 保险箱，支持自动验证及恢复码无损重设。
- 在已适配的普通导航与搜索中隐藏受保护条目，保留 dsh 原生对话操作、侧边栏视图和排序。
- 提供按工作区分组的正文摘要、工作区及父会话继承保护、统一侧边栏滚动。
- 在插件自有记忆工具内分离普通与私密记忆。
- 仅提供解除锁定，不提供聊天删除、回收站或永久删除。
- 提供可互相切换的英文和简体中文文档。

本版本适配 dsh 0.2.1-rc.2 Web 和 Node.js 24+，提供界面隐藏，不提供加密或完整访问控制。具体行为与限制见 README。
