# Changelog / 版本说明

[English documentation](README.md) · [中文文档](README.zh-CN.md)

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
