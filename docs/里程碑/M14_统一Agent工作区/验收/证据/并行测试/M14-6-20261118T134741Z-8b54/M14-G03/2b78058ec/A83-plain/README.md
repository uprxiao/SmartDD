# A83 普通目录真实模型补验

2026-11-19，macOS arm64，`feature/0.1.6`。第 344 次复用 Claude Code 构建的隔离签名候选 `2b78058ec1e55c027f69ceb2d3c8fcbef1c69286`，包 SHA-256 为 `7712450f6430db759657bdec03a2e155b05cb96764b2e9a31711ad08306bcc5c`。本机 Claude 父与 Codex 子都使用 DeepSeek，合成项目只访问 DeepSeek 官方 API。启动前核对真实包签名与 ASAR 哈希，App 主进程核对私有 HOME、userData、PID 并确认模型 Key 未传入。未装入日常应用目录。 [签名包基线](../../../M14-G03/1214412aa-claude-shared/driver/package-2b78058ec1e55c027f69ceb2d3c8fcbef1c69286-sha256.txt)

| 用例判据 | 第 344 次实际观察 |
| --- | --- |
| 当前目录与基线对照 | 普通目录无 Git 或 SVN 元数据。冻结副本与当前目录使用同样的 Node 测试文件。运行前用实际命令核对，冻结副本退出 1，当前改动退出 0。Git HEAD 的对照仍用 340–343 四次同包结果。 |
| 真实委派与回传 | 真实输入触发 Claude 在同一项目派一个 Codex 子任务。子任务使用共用目录，真实工具调用输出 TAP `pass 1 / fail 0` 与退出码 0。子结果回父，夹具文件内容哈希不变。 |
| 同根独立任务 | 同时已经运行的无关任务保持相同 runId，并跨过子结果回父的时刻。其真实模型请求在私有回环转发处暂停转发，核对后放行，原运行正常返回 `A83_INDEPENDENT_DONE`。 |
| 环境和收尾 | 两种协议合计 10 条合成测试请求均为 HTTP 200，未批准任何工具请求，渲染无错误。App 退出 0，八条登记的 CLI／桥进程均已退出，并核对进程身份和回环监听已关闭。 |

前四次真实 Git 正反验证按原 Git HEAD、X1 与 DeepSeek 记录保留。第 344 次完成 P3、实际只读命令及同根独立任务补验。 [Git 批次原证](../../1214412aa-claude-shared/README.md#9-a83-与-a85-补验2026-11-19) · [344 结果](result.json) · [子结果回父时的界面](19-parent-result-unrelated-active.png) · [独立任务收口界面](20-live-result.png) · [进程收尾](processes-after-quit.json) · [证据哈希](sha256.txt)

驱动使用本轮隔离候选路径，从 Claude Code 的真实模型 Git 夹具改成普通目录双副本对照。普通目录的验证使用同根、同运行的 UI 与原生回执，保留了独立请求的暂停、放行及原运行收尾。 [驱动](driver/a83-plain-live.mjs)
