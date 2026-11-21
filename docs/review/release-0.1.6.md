# WillYou v0.1.6 发布记录

WillYou v0.1.6 已公开为 GitHub 预发布，附注标签指向 `7a8198b9bb4768605310998a00851ffee4380512`。M14 在 macOS arm64 的 73 条适用用例全部通过，范围见阶段交付说明。[GitHub Release](https://github.com/uprxiao/SmartDD/releases/tag/v0.1.6) · [M14 交付说明](../里程碑/M14_统一Agent工作区/交付说明.md)

- 候选分支和 `main` 的完整 CI 均通过。标签工作流独立复跑 CI，四个目标的安装包构建、上传及发布全部成功。[候选 CI](https://github.com/uprxiao/SmartDD/actions/runs/44902014890) · [main CI](https://github.com/uprxiao/SmartDD/actions/runs/44904798041) · [标签工作流](https://github.com/uprxiao/SmartDD/actions/runs/44904839142)
- 公开资产包含七个安装包、四份平台清单和一份 SHA-256 校验文件。七包的字节数和摘要与发布清单逐一相符。实际从 GitHub 下载的 Mac arm64 DMG 为 619,051,094 字节，SHA-256 为 `804f0e4adf1756ab80f7563ed6dee0c1ade9a473222f22cc6c06ab6b16de5ac3`。[公开下载及核验回执](release-0.1.6-evidence.json)
- 本机候选包及公开 Mac arm64 DMG 分别用只读挂载、独立目录和独立用户数据安装验收。两个包都通过六项原生组件检查及十项 App 检查，包括切任务后的终端回显、浅色／深色与窄窗，以及 Claude 和 Codex 各一轮真实 CLI、本地合成应答。两次 App 与 PTY 正常退出。[安装及运行回执](release-0.1.6-evidence.json)

本版为个人试用预发布，Mac 包未做 Apple Developer ID 签名和公证。Intel Mac 尚未完成本期完整业务验收，Windows 与 Linux 安装包为实验性。
