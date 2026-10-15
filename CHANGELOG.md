# Changelog

版本是否已发布以 GitHub Release 为准。

## 0.0.3

- 接入用户选定的橙色蚂蚁举重 Logo，覆盖应用页面、开发模式 Dock，以及 Mac/Windows/Linux 安装包图标。
- 对照本地 Yoda 增加 Windows x64 MSI，以及 Linux x64 AppImage、DEB、RPM；保留 Mac arm64/x64 DMG 与 Windows EXE，共七个安装包。
- 新增 Ubuntu 构建任务；Windows MSI 和三个 Linux 格式必须解出真实应用并通过版本、架构、SQLite、PTY 检查，再进入 Release。完整性检查覆盖全部格式、来源提交与 SHA-256，缺包禁止发布。
- 继续采用无签名、无公证的个人自测预发布。Windows 和 Linux 为实验性安装包，桌面安装升级、终端、CLI、Skill 和系统安全存储的完整业务验收尚未完成；不代表稳定支持。
- 自动更新仍是 PRD 中的后续功能；本版提供手动下载。Mac 网络下载后首次打开的系统安全限制仍适用。

## 0.0.2

- 修复标签发布时 checkout 把本地附注标签替换成提交对象、导致元数据校验失败的问题；保留严格的标签与 main 归属校验。
- 修复 Windows 包内原生检查全部通过后，ConPTY 后台句柄令验证进程无法退出、构建被误判超时的问题。
- 交付 0.0.1 的项目、AI 任务、Skill、配置注入与多平台构建功能；此版本继续采用无签名、无公证的个人自测预发布。
- Mac arm64 已完成真实业务与本机打包验收；Mac x64 尚待完整业务验收。Windows 为实验性构建，终端、CLI 和 SSH Skill 的业务适配仍待完成。各目标安装包均需通过本次构建和包内 SQLite/PTY 检查后才上传发布。
- 网络下载后的首次打开可能被 macOS 拦截；Apple 签名、公证将在正式对外分发前接入。

## 0.0.1

- 项目、数据库、SSH 连接和 AI 配置管理。
- Claude Code / Codex 终端任务、会话恢复与终端颜色显示。
- 项目 Skill、MCP 和配置注入；完成 Mac 上的 AIS 只读数据库与 SSH 调查验收。
- 增加 Mac arm64、Mac x64、Windows x64 构建配置，以及标签触发的发布流程。

此版本为个人自测用的 **预发布版本**，无 Apple Developer ID 签名和公证；从网络下载后 macOS 可能拦截首次打开。Apple 签名与公证列入对外正式分发前的待办。

平台验收：Mac arm64 已完成真实业务流程与本机 DMG 安装内容检查；Mac x64 尚未完成完整业务验收。Windows 为实验性构建，终端启动、CLI 查找和 SSH Skill 的系统适配尚未完成。三个目标的构建与包内 SQLite/PTY 检查由本次 GitHub Actions 执行；构建成功不代表未验收的业务功能可用。
