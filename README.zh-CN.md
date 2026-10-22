# DeepSeek Harness 锁定聊天插件

[English](README.md) · **简体中文**

独立 dsh Web 插件，使用四位 PIN 隐藏指定聊天及工作区，支持恢复码、原生对话组件和插件记忆分离。

**仅提供界面隐私保护：**不会加密聊天文件，也无法保护所有 API、客户端或外部记忆来源。

## 安装

需要 Node.js 24+ 和 dsh 0.2.1-rc.2。

```sh
dsh plugin --profile web add dsh-plugin-locked-chats@0.1.0
```

安装后重启对应 profile，刷新 Web 界面。

- [简体中文使用与开发文档](plugin/README.zh-CN.md)
- [English user and developer guide](plugin/README.md)
- [版本说明](plugin/CHANGELOG.md)

插件源码位于 `plugin/`。本仓库的 commit 信息统一使用英文。

## 许可证

[MIT](LICENSE) © 2026 Hao Peng。
