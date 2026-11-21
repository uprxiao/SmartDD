# M14 设计复核（2026-11-16）

本目录按时间保留 Claude Code 对 M14 的三轮独立复核。首轮输入为 R0.2／T0.1，第三轮输入为 R1.1／T1.1；最新结论见[三次复核](三次复核.md)：研究关闭，可进入原型与用例评审。现行文档从[阶段入口](../../README.md)进入，历史报告保留原结论和证据边界。

| 文件 | 内容 |
| --- | --- |
| [复核报告.md](复核报告.md) | 结论、问题清单（逐条要求 Codex 修改的内容）、需补研究、可删减项、待用户决定项 |
| [验证记录.md](验证记录.md) | 每项复现／新验证的环境、命令、结果 |
| [probes/](probes/) | 新写的验证代码（本机 CLI + 真实模型），可直接复跑 |

## 本次复核依据的用户决定（2026-11-16）

1. 三件核心事统一设计：统一任务界面、同任务切换 Provider 续聊、多 Agent 委派。开发可以分批，设计一次想清楚。
2. 界面：任务区复刻 T3（消息气泡、可折叠的工作过程、新任务空白页）；底部输入框保留 WillYou 现有输入框；左侧栏保持现状；右侧用现有文件、浏览器组件。具体视觉细节在原型阶段确定。
3. 旧任务不迁移：项目处于初期、没有外部用户。新任务全部走统一界面。项目、配置、凭据、插件、Skill／MCP 等业务数据照常保留。
4. 新增：消息中的文件路径、URL 与右侧文件工作区、内置浏览器联动。
5. 插件、Skill、MCP、文件、浏览器的接入方式和效果不受影响（M13 已测试通过）。
6. 上层统一抽象，后续接入 OpenCode、Cursor、Kiro 等 Agent，对标 T3。
7. 运行程序按 T3：用本机已安装的 CLI，**发现什么版本用什么版本**；SDK 库随应用锁定版本。不做受管下载。
8. T3 参考以本机最新代码为准（`fe59fa44d0`）。
9. 订阅／原生登录沿用用户自己的 Codex／Claude 扩展（MCP、hooks、插件、Skill），每轮显式下发权限；WillYou 托管供应商隔离（按 T3，与 M13 一致）。
10. 保留手动终端（参照 T3 终端抽屉）；“终端即任务”代码和 `legacy-*` 旧数据兼容层在 M14 开发完成并测试通过后清理，随 M14 发版。
11. 委派目录协调首期做方案 B（共用目录、写入排队、只读并行）；Git worktree 并行写（方案 C）等 B 稳定后再加。
12. 首期做每轮改动文件与差异查看；不做回退，回退由用户用 git／svn 命令处理。

## 复跑

探针依赖：Node 22+、本机 `claude`、`codex`、`opencode`；`M14_CLAUDE_SDK` 指向 `@anthropic-ai/claude-agent-sdk@0.3.321` 的 `sdk.mjs`；Claude 路径用 `DEEPSEEK_API_KEY`（只经环境变量传入，任何文件都不保存）；Codex 用本机 ChatGPT 登录（探针会逐个禁用用户已有 MCP、apps、plugins）。

```bash
cd probes
DEEPSEEK_API_KEY=... M14_CLAUDE_SDK=.../sdk.mjs node real-delegation.mjs /tmp/out        # V01 / V07
DEEPSEEK_API_KEY=... M14_CLAUDE_SDK=.../sdk.mjs node real-switch.mjs /tmp/out            # V02
DEEPSEEK_API_KEY=... M14_CLAUDE_SDK=.../sdk.mjs node real-events.mjs /tmp/out            # V03
node event-coverage.mjs <原实验 adapters.mjs> <native.jsonl...>                           # V04
node link-resolution.mjs <t3code 根> <esbuild 包路径> /tmp/out                            # V05
DEEPSEEK_API_KEY=... M14_CLAUDE_SDK=.../sdk.mjs node skills-under-sdk.mjs /tmp/out       # V06
DEEPSEEK_API_KEY=... M14_CLAUDE_SDK=.../sdk.mjs node real-approval.mjs /tmp/out          # V08
node real-turn-override.mjs /tmp/out                                                    # V09（只需本机 Codex 登录）
```


## Codex 修订接续

按原报告的处理与证据见[Codex 修订核对](Codex修订核对.md)。该回执保留首轮时点；[二次修订核对](Codex二次修订核对.md)对应第三轮复核输入，[三次收尾](Codex三次复核收尾.md)记录最后的文字与导航勘误。原报告与验证事实继续保留。

## 二次复核

按原报告 §9 对 Codex 修订的独立复核结论见[二次复核](二次复核.md)。

按二次复核 §5 的第三轮复核结论见[三次复核](三次复核.md)：§9 全部关闭。

## Windows 检出兼容归档（2026-11-21）

38 个已跟踪的探针原始日志超过 Windows CI 的检出路径长度限制。仓库改为保存短路径归档，解包后仍得到每个原相对路径和原始字节。已在空目录实际恢复并逐项核对 SHA-256、文件模式及原 Git blob。既有报告和历史清单保留原路径记录。[原 CI 失败](https://github.com/uprxiao/SmartDD/actions/runs/44890259052) · [归档](probes/evidence/windows-checkout-evidence-20261121.tar.gz) · [原路径与哈希清单](probes/evidence/windows-checkout-evidence-20261121.json)

在 macOS 或 Linux 上可将归档解到一个空目录。路径从仓库根开始，恢复后可按清单核对文件。

```bash
restore_dir="$(mktemp -d)"
tar -xzf probes/evidence/windows-checkout-evidence-20261121.tar.gz -C "$restore_dir"
```
