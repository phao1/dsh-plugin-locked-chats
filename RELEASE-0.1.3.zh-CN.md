# v0.1.3：中英文界面与最新发布版兼容验证

简体中文 | [English](RELEASE-0.1.3.en.md)

日期：2026-10-25。本版本将此前已完成的英文化源码交付为安装包；不开发一键升级器，不修改 DSH 源码。

## 版本与语言

- 本次查阅官方 npm：DSH `latest` 为 `0.2.1-rc.2`、`next` 为 `0.2.1-rc.3`；[官方 Releases](https://github.com/deepseek-ai/deepseek-harness/releases) 最新预发布也是 rc.3。未将未发布主分支冒称已适配发行版。
- 插件保持兼容上述两版，不改为 `*`，无需新增宿主适配代码。
- 插件 0.1.3 的导航、设置、PIN/恢复、锁定/解除锁定、错误、摘要占位符、相对时间和无障碍标签支持 English / 简体中文。
- 在宿主 **设置 → 通用设置 → 语言** 选择 English 或中文。无需单独英文安装包，用户填写的会话标题、正文不翻译。
- 独立设置页支持浏览器语言偏好及 `?lang=en` / `?lang=zh`。恢复流程没有变化。

## 本轮验证

| 范围 | 结果 |
| --- | --- |
| 自动测试 | rc.2 和 rc.3 接口环境各 77 项通过，0 失败；类型检查与构建通过 |
| 兼容声明 | 两版真实宿主兼容检查器均接受，无版本豁免 |
| 包升级 | 停止隔离宿主后通过官方 CLI，将两套既有测试 profile 从 0.1.2 tgz 覆盖安装为 0.1.3；未重设凭据、未重建聊天数据 |
| rc.2 / rc.3 Web | 原生设置切到英文；显示已有 PIN/恢复码；原 PIN 四位自动解锁；打开旧锁定会话并通过原生输入框继续聊天；普通 New Session 不进入保险箱草稿 |
| rc.3 Web 补充 | 原生会话菜单锁定及英文确认；锁定后普通列表隐藏；搜索新私密正文标记无结果；锁定组展开/收起；切换平铺视图；拖拽改变顺序并在刷新后保留；切回中文 |
| 浏览器控制台 | 两个验收标签页均未捕获 error |
| 凭据与数据 | 本轮 Web 验证原 PIN 和既有会话/锁记录；未修改恢复码。恢复/表单/语言切换由自动化测试覆盖；未在浏览器实际重置 PIN 或消费恢复码 |

所有会话均为隔离合成数据，回复来自本地无密钥模型，未调用外部模型；截图中的中文回复与模型名是测试数据，不是漏翻译。首次 Playwright `fill` 逐格输入未能稳定驱动原生 PIN 控件；改用真实键盘输入/粘贴后四位自动验证成功，两版均复核键盘路径。

最终安装包在文档更新后重新打包；27 个运行文件、清单和插件配置与浏览器验收包逐字节一致，仅包内中英文 README 和更新日志不同。Release 同时提供校验和与机器可读验证记录。

## 实际截图

rc.3 英文设置：

![rc.3 英文设置](assets/screenshots/v0.1.3/rc3-settings-en.png)

rc.3 英文保险箱：

![rc.3 英文保险箱](assets/screenshots/v0.1.3/rc3-vault-en.png)

rc.3 切回中文：

![rc.3 中文设置](assets/screenshots/v0.1.3/rc3-settings-zh.png)

其他证据：[英文 PIN](assets/screenshots/v0.1.3/rc3-pin-en.png)、[rc.3 继续聊天](assets/screenshots/v0.1.3/rc3-continue-en.png)、[rc.2 设置](assets/screenshots/v0.1.3/rc2-settings-en.png)、[rc.2 继续聊天](assets/screenshots/v0.1.3/rc2-continue-en.png)。

## 安装与限制

[v0.1.3 Release](https://github.com/phao1/dsh-plugin-locked-chats/releases/tag/v0.1.3) · [安装包](https://github.com/phao1/dsh-plugin-locked-chats/releases/download/v0.1.3/dsh-plugin-locked-chats-0.1.3.tgz)

同一桌面 profile/数据目录升级应保留聊天、锁定记录、PIN 和恢复码。操作方式见[安装文档](README.zh-CN.md)。本轮没有修改用户正在使用的桌面实例、升级 DSH 本体或操作生产数据。

桌面端实际安装/升级未验收，Web 不代替桌面；深色主题与全部原生菜单未在本轮穷举。无自制一键升级助手/临时进程，不含尚未发布主分支的原生更新接口。只交付 GitHub 安装包；本轮未发布 npm，查询时 npm latest 为 0.1.1。

历史实现与不同模型评审记录见 [LOCALIZATION.zh-CN.md](LOCALIZATION.zh-CN.md)，其中之前的浏览器限制不代表本轮结果。本轮没有再次调用 Claude 或其他模型。
