# Changelog

版本是否已发布以 GitHub Release 为准。

## 0.0.1

- 项目、数据库、SSH 连接和 AI 配置管理。
- Claude Code / Codex 终端任务、会话恢复与终端颜色显示。
- 项目 Skill、MCP 和配置注入；完成 Mac 上的 AIS 只读数据库与 SSH 调查验收。
- 增加 Mac arm64、Mac x64、Windows x64 构建配置，以及标签触发的发布流程。

此版本为个人自测用的 **预发布版本**，无 Apple Developer ID 签名和公证；从网络下载后 macOS 可能拦截首次打开。Apple 签名与公证列入对外正式分发前的待办。

平台验收：Mac arm64 已完成真实业务流程与本机 DMG 安装内容检查；Mac x64 尚未完成完整业务验收。Windows 为实验性构建，终端启动、CLI 查找和 SSH Skill 的系统适配尚未完成。三个目标的构建与包内 SQLite/PTY 检查由本次 GitHub Actions 执行；构建成功不代表未验收的业务功能可用。
