# T3 Code、Codex 与 DeepSeek：可复用多 Agent 工作流调研

调研日期：2026-11-14（Asia/Singapore）。范围：T3 官方仓库与作者公开流程、Claude/Agent Skills 文档、开源流程包、独立编排工具及公开用户讨论。未安装任何调研中的第三方插件，未实测它们在当前 DeepSeek 实例里的多 Agent 兼容性。本文区分项目提供的能力、用户自述与适配建议，不给出全网使用率排名。

## 结论

用户不需要每次重写完整的分工提示词。补充对 GitHub 仓库和代码的定向检索后，已找到 pstack-t3、r3xstack、axstack 等直接围绕 T3 的完整流程候选；此前仅围绕 tstack/bstack 的结论不完整。对需求、调研、设计、开发、单测、Review、E2E 的复杂流程，应优先评估 creedants/pstack-t3；tstack 仍适合轻量交付和审查。现成 Skill/Playbook 包与确定性脚本工作流运行时需要区分。

重复规则通常分为四层：项目规则（AGENTS.md/CLAUDE.md）、可复用流程（Skill/插件）、模型与提供商选择（路由配置）、程序化验证（脚本、测试、CI）。自然语言是启动入口，规则和执行资源可以预先保存。Agent Skills 本身是包含 SKILL.md、可选脚本和模板的开放格式，支持按需加载。[Agent Skills](https://agentskills.io/home)

## 最贴近 T3 的现成方案

### 补充发现：直接面向 T3 的更完整流程包

前一轮检索漏掉了下面的方案，不能把“当时只核实两个”写成“只有两个”。Tstack 是 Theo 的项目；bstack 是另一位社区作者的项目。

| 项目 | 已核实的 T3 集成与流程 | 适用边界 |
| --- | --- | --- |
| [creedants/pstack-t3](https://github.com/creedants/pstack-t3) | 当前文档列出 63 个 Skills，统一入口 poteto-mode，架构探索、多模型审查、隔离工作树、验证技能生成，以及常驻 brigade 协调器；通过 T3 工具派活 | 当前说明要求 T3 0.1.3+；项目 E2E 启动与操作路径仍需配置。约 19 stars，不能称大规模成熟通用标准 |
| [mariusflorescu/pstack-t3](https://github.com/mariusflorescu/pstack-t3) | 另一份 T3 移植，52 Skills；setup-pstack 从 T3 目录选角色模型 | 与 creedants 版本是不同仓库，安装和角色配置格式不能混用 |
| [r3xsean/r3xstack](https://github.com/r3xsean/r3xstack) | 明确要求 T3；see-it-through 串接方案讨论、实现、独立 code-loop、真实验证；另有 UI design-process | 个人默认包含 Sol/Opus/Fable/Astra，当前 Codex+DeepSeek 组合需要调整；项目规模小，未在本机实测 |
| [axatbhardwaj/axstack](https://github.com/axatbhardwaj/axstack) | align → spec → tickets → implement → review → watch，研究、验证与 TDD 都有技能；使用可见 T3 编排 | 文档明确仅支持 Linux，要求稳定 T3 0.1.0+，不支持 Nightly；不适合当前 macOS Nightly 直接装 |
| [escoffier-labs/brigade](https://github.com/escoffier-labs/brigade) | 共享任务、记忆、交接与执行证据，有 T3 连接 | README 明确完整 T3 子任务治理仍在推进，不能当已完成的全流程 T3 插件 |
| [ccdwyer/workflow-boards-plugin](https://github.com/ccdwyer/workflow-boards-plugin) | 有看板、状态机和 agent step pipeline 的插件源码 | 依赖带插件系统分支的 T3 与尚未发布的 SDK，不是当前官方 Nightly 可直接安装的承诺 |

pstack-t3 的角色配置可以固定：`~/.config/pstack-t3/roles.json` 为用户级，`.pstack/t3-roles.json` 为仓库级。角色通过当前 T3 目录解析为 provider/model/options。常驻协调器可接收连续请求并派给 worker，模型互审、工作树隔离和结果回传已有实现。这里的 brigade 是 pstack 内的一项技能，与上表独立的 Brigade Stack 项目不同。[运行原理](https://github.com/creedants/pstack-t3/blob/main/docs/how-it-works.md)

E2E 方面，pstack 提供 create-verification-skill / maintain-verification-skill：使用项目实际的浏览器、设备、CLI 或服务入口生成并验证验收流程。它提供机制，不会凭空替任何项目附送完整业务测试。[技能清单](https://github.com/creedants/pstack-t3/blob/main/docs/skills.md)

维护者还公开记录了在真实 T3 和临时仓库里运行多模型 Autopilot 的结果及暴露的问题；这是维护者自述的样本运行，不能替代在当前机器上的兼容性验证，也不能作为全行业使用率或稳定性证明。[Live runs](https://github.com/creedants/pstack-t3/blob/main/docs/live-runs.md)

### t3dotgg/tstack

作者 README 明确称其为自己日常使用的技能，支持 Claude Code 与 Codex；部分技能专门使用 T3 功能。[README](https://github.com/t3dotgg/tstack/blob/main/README.md)

| 流程 | 实际用途 | 对当前配置的意义 |
| --- | --- | --- |
| sol-loop | 调用 GPT Sol 审查改动、处理问题并复审；默认 3 轮 | 可以从 DeepSeek 主对话委派到 Codex/Sol，是最直接的两模型合作 |
| full-stop | 完成改动、证明行为、审查、建 PR、跟进检查，最后交给用户合并 | 属于完整交付流程，需要 GitHub CLI 与相应仓库权限和检查配置 |
| full-send | 完整交付并在门槛满足后合并 PR | 比 full-stop 多了自动合并这一行为，不应和前者混为一谈 |
| council | 三个不同提供商的模型并行给出审查意见并迭代 | 默认要求三个可用提供商；目前只有 Codex 和 Claude/DeepSeek 时不能原样照搬默认配置 |

sol-loop 源码在 T3 分支中明确调用 orchestrator_capabilities 解析可用模型，再用 delegate_task 派出审查子任务，并保存任务身份和问题账本。[sol-loop](https://github.com/t3dotgg/tstack/blob/main/skills/sol-loop/SKILL.md)

council 同样通过 T3 delegate_task 并行调用不同提供商；这些是实际子任务，不只是一个回答中切换角色。[council](https://github.com/t3dotgg/tstack/blob/main/skills/council/SKILL.md)

full-stop 的完整流程依赖 full-send、sol-loop、file-pr、babysit-pr 等关联技能，不能只复制一个文件就假定端到端流程齐全。[full-stop](https://github.com/t3dotgg/tstack/blob/main/skills/full-stop/SKILL.md)、[full-send](https://github.com/t3dotgg/tstack/blob/main/skills/full-send/SKILL.md)

公开反馈还报告过跨提供商推理强度未显式设置、审查任务长期不结束以及 PR 检查器前提不匹配的问题。它们是用户报告，不代表每次都发生；说明流程应对实际模型、轮次和仓库检查进行一次适配。[推理强度反馈](https://github.com/t3dotgg/tstack/issues/5)、[审查挂起反馈](https://github.com/t3dotgg/tstack/issues/8)、[PR 检查前提反馈](https://github.com/t3dotgg/tstack/issues/7)

### gitbobobo/bstack

这是另一个真实的 T3 用户实践：Skill 负责组织任务，route.mjs 按规则选择 harness/model，个人覆盖保存在 ~/.config/bstack/t3-orchestrator.json，底层通过 T3 delegate_task 执行，还有巡检和持续派活技能。旧地址 gitbobobo/skills 已迁移到 gitbobobo/bstack。[当前 README](https://github.com/gitbobobo/bstack/blob/main/README.md)、[t3-orchestrator](https://github.com/gitbobobo/bstack/blob/main/skills/bstack/t3-orchestrator/SKILL.md)

它证明 T3 社区已有“配置 + 脚本 + Skill”的固定编排。不过默认入口偏好 pi/codex/devin/droid，带有作者自己的额度和权限策略，并非给当前 Claude Code/DeepSeek 原样安装即可的通用预设。

## 更广泛的现成流程包和工具

| 方案 | 主要机制 | 怎样复用 | 与当前 T3 配置的关系 |
| --- | --- | --- | --- |
| Superpowers | 自动触发的组合式 Skills，设计、计划、实现、测试与审查 | 安装后按任务触发，或明确调用技能 | 支持 Claude Code 和 Codex，但“两个都支持”不表示自动在二者间路由 |
| BMAD Method | 需求、规格、架构和交付流程，角色与上下文产物 | 项目安装后通过流程技能推进 | 更偏项目全过程；调研时稳定线与预览线并存，安装前应选定一条 |
| GSD Core | 分阶段规划、执行、验证，重工作放入新上下文子 Agent | Discuss → Plan → Execute → Verify → Ship | 支持多种 CLI；当前项目是 open-gsd/gsd-core，不应盲用旧博客中的包名和路径 |
| gstack | 产品、工程、审查、QA 等专门角色 Skills | 用简短角色命令启动对应工作 | 角色工作流不必然表示所有角色都是并行运行的独立 Agent |
| Oh My Claudecode | autopilot、team、验证与修复循环 | 短命令和已命名流程配置 | 带自己的运行时；原生 team 与 tmux CLI worker 是不同路径，不能假定完整嵌入 T3。当前命名 stage profile 文档还限定 Linux |
| GitHub Spec Kit Workflows | YAML 定义，串接 Agent 命令、提示词、Shell、控制流和人工关卡 | workflow run / status / resume | 适合严格可恢复流程，是独立编排能力；不同步骤混用当前 T3 实例尚未验证 |
| Cezar | 工作流 YAML、逐步 runner、Shell 验证和有限失败重试 | 选择已保存工作流；有拖拽链编辑 | 有配置式跨 CLI 示例，但属于独立工具；未实测 DeepSeek 适配与成熟度 |
| Orchestrator.inc | 独立桌面工作区，主 Agent、worker、worktree 与 CI 反馈 | 在应用中管理任务和反馈 | 属于另一个控制平台，不是安装进 T3 的插件 |
| Vibe Kanban | 看板任务、不同 CLI、隔离工作区和审查 | 从任务板推进 | 官方 README 当前声明 sunset、转社区维护，不能直接沿用旧教程对托管服务的承诺 |

以上能力依据项目的当前主文档，而非把每个项目都在本机运行过：

- [Superpowers](https://github.com/obra/superpowers/blob/main/README.md)
- [BMAD](https://github.com/bmad-code-org/BMAD-METHOD/blob/main/README.md)
- [GSD Core](https://github.com/open-gsd/gsd-core/blob/main/README.md)
- [gstack](https://github.com/garrytan/gstack/blob/main/README.md)
- [Oh My Claudecode](https://github.com/yeachan-heo/oh-my-claudecode/blob/main/README.md)
- [Spec Kit Workflows](https://github.github.io/spec-kit/workflows/overview.html)
- [Cezar 工作流与配置](https://github.com/brzozass/cezar.orchestrator/blob/main/docs/reference.md)
- [Orchestrator.inc](https://github.com/OrchestratorInc/agent-orchestrator/blob/main/README.md)
- [Vibe Kanban](https://github.com/BloopAI/vibe-kanban/blob/main/README.md)

## 固定指令与脚本编排的边界

保存 Skill 可以固定角色和步骤，且支持携带可执行脚本，但仅有指令文字时，下一步仍由模型选择。Claude Code 原生 Dynamic Workflows 则把编排放入 JavaScript，保存到项目 .claude/workflows/ 或个人配置目录的 workflows/，可重复作为命令运行。T3 源码有此类运行进度与脚本展示支持；这不能直接推导出该能力可作为 Codex + DeepSeek 的通用跨提供商编排器。[Claude Workflows](https://code.claude.com/docs/en/workflows)

Spec Kit 的工作流文档则明确提供 YAML、控制流、人工门槛、持久运行状态与恢复命令，说明严格脚本编排已有现成实现，不必笼统认为一定要从零造引擎。[Spec Kit Workflows](https://github.github.io/spec-kit/workflows/overview.html)

## 真实用户讨论反复出现的做法

一个 Claude Code + Codex 使用者讨论中，参与者描述了短项目规则、独立上下文、明确职责和书面交接；实现者与审查者采用不同会话，减少人工来回复制消息。这是具体用户经验，不能据此推出全行业使用率。[讨论](https://www.reddit.com/r/codex/comments/1wyzbib/claude_code_codex_users_what_does_your_actual/)

另一讨论中有使用者选择更轻的流程，提到某些全套流程消耗过多 tokens 或把小改动复杂化。这表明不宜把所有框架同时叠装。[讨论](https://www.reddit.com/r/ClaudeCode/comments/1vxricj/moving_away_from_superpowers_how_do_you_guys/)

Vibe Kanban 使用者也公开分享了把 PRD、计划、任务上下文和执行封装成短命令并接 MCP 的做法，同时说明自己仍保留人工测试和合并环节。[讨论](https://www.reddit.com/r/ClaudeCode/comments/1qysxqt/using_claude_code_vibe_kanban_as_a_structured_dev/)

T3 的持久协调器讨论仍是功能提案；不能把提案描述的项目总览误报成已经提供的工作流编辑器。[T3 Discussion 16269](https://github.com/pingdotgg/t3code/discussions/16269)

## 对当前机器的建议

1. 对完整需求到 E2E 的流程，先评估 creedants/pstack-t3：用 setup-pstack 固定 Codex/DeepSeek 的角色分配，用 poteto-mode 作为单次入口；需要持续项目总控时再启用其 brigade 协调器。先验证一个小需求及其真实子线程、模型、回传和测试证据。若只要轻量改动审查，再选 tstack sol-loop。
2. 需要完整交付时再选 full-stop 及其依赖；它会建 PR 并跟进检查，不能把它当作只做本地修改的同义词。
3. 不应在未评估 pstack-t3 等现成 T3 流程包前断言必须自建 BMAD 适配。Superpowers、BMAD 和 GSD Core 仍是通用方法候选，初期应选一套主要方法而非叠装全部。
4. 将项目规范、默认提供商/模型、验收命令等偏好保存在项目规则中。Tstack README 本身也建议把个人模型偏好放在 CLAUDE.md/AGENTS.md，而不是把所有偏好写死在可更新的技能里。
5. 当前 DeepSeek 实例使用独立目录 /Users/hx/.claudedeepseek。它的个人技能应放在该目录的 skills/ 下，或采用项目级 .claude/skills；仅装到默认 ~/.claude/skills 可能被这个实例遗漏。Codex 还应装入其实际使用的技能目录。T3 文档确认技能来源与配置目录有关，重启 Agent session 后再核对加载。[T3 Claude 技能说明](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-claude.md#skills)

配置完成后的目标交互是“具体需求 + 一个短流程名”，例如描述改动后追加 sol loop；不需要每次复述几百字的角色、交接和审查步骤。目前上述流程包尚未安装。
