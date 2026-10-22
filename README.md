# Locked Chats for DeepSeek Harness

**English** · [简体中文](README.zh-CN.md)

A standalone dsh Web plugin for hiding selected chats and workspaces behind a four-digit PIN, with recovery codes, native conversation controls, and plugin-scoped memory separation.

**UI privacy only:** this does not encrypt chat files or protect every API, client, or external memory source.

## Install

Requires Node.js 24+ and dsh 0.2.1-rc.2.

```sh
dsh plugin --profile web add dsh-plugin-locked-chats@0.1.0
```

Restart the profile and refresh the Web interface.

- [English user and developer guide](plugin/README.md)
- [简体中文使用与开发文档](plugin/README.zh-CN.md)
- [Release notes](plugin/CHANGELOG.md)

The plugin lives in `plugin/`. Commit messages for this repository must be written in English.

## License

[MIT](LICENSE) © 2026 Hao Peng.
