# pstack-t3 深入分析与七阶段开发流程适配

分析日期：2026-11-14。

对象是 `creedants/pstack-t3`，固定到提交 `dd15e6301eb6bbd04866a5091f50f801fbb2a5ed`，提交日期 2026-11-07。不是另一个同名移植版本 `mariusflorescu/pstack-t3`。本文是源码与文档分析，未安装、未运行其多 Agent 流程。

## 1. 结论

它适合作为“需求 → 调研 → 设计 → 开发 → 单测 → Code Review → E2E”流程的现成基础，尤其擅长任务拆分、跨模型委派、工作区隔离、独立审查、返工和交付。

它不是一个安装后就严格执行这七个阶段的通用工作流引擎。默认 Feature 流程没有完整的产品需求规格阶段；`why` 的主要用途是追查已有系统的决策依据；`architect` 主要做技术架构；测试覆盖必须由项目规则和项目工具明确。

最适合当前需求的组合是：常驻 `$brigade` 协调线程、项目长期规则、显式模型角色配置，以及项目专属验证 Skill。前两项固定工作方式，角色配置决定 Codex/DeepSeek 如何分工，验证 Skill 固定如何真实运行和验收应用。无需每次重发长篇协作提示词。

## 2. 它的几层结构

| 层次 | 实际职责 |
| --- | --- |
| `$poteto-mode` | 为一次有限任务选择 Feature、Investigation、Multi-phase-plan、Autopilot 等 Playbook |
| 工作技能 | `how` 理解系统，`why` 调查历史与动机，`architect` 比较设计，`arena` 比较候选，`swarm` 分片执行，`interrogate` 对抗式审查 |
| `$brigade` | 常驻项目协调器：接收后续需求，记录任务，派发负责人，接收报告，安排验证和交付 |
| T3 runtime | 通过 `delegate_task`、`t3_thread_launch`、调度、PR watcher、Preview 等工具真正执行 |
| Python/Node 脚本与状态文件 | 验证角色和委派简报，保存任务与审查结果，维护工作区租约及 landing queue |

所以它既包含模型读取的协作规则，也包含程序化的状态和检查。不能把整个流程视为纯提示词，也不能把所有自然语言步骤视为程序已经强制执行。

来源：[运行时](https://github.com/creedants/pstack-t3/blob/dd15e6301eb6bbd04866a5091f50f801fbb2a5ed/skills/pstack-runtime/SKILL.md)、[协调器](https://github.com/creedants/pstack-t3/blob/dd15e6301eb6bbd04866a5091f50f801fbb2a5ed/docs/guide/coordinator.md)。

## 3. 默认的新功能流程

Feature Playbook 的主线是：

1. `how` 理解涉及的子系统。
2. `architect` 探索设计方案。
3. 检查哪些前置步骤阻塞后续、哪些任务可以并行、哪些任务会写共享状态，以及是否一个实现者就够了。
4. 把实现交给 `feature, refactoring` 角色，简报写明范围、文件、数据模型和成功标准。
5. 在匹配的真实运行界面验证；无法确定和验证错界面都不能算通过。
6. 整理成小而有序的提交。
7. 对有争议的设计进行进一步审查；light 模式通常由 gate review 承担审查，争议可升级。
8. 进入 Opening a PR 流程。

父 Agent 的主要职责是设计、计划、审查和验证，代码实现交给子任务。强耦合功能通常交给一个负责人，再由负责人在必要时细分；不是每个阶段都机械地启动一个 Agent。

特别注意：原生流程中的实际验证常在最终审查之前。若要严格采用“单测 → Code Review → E2E”，应保存这条顺序，并在 E2E 后由协调器核对最终证据和当前提交。它默认没有这七个中文阶段的专用状态栏。

来源：[Feature](https://github.com/creedants/pstack-t3/blob/dd15e6301eb6bbd04866a5091f50f801fbb2a5ed/skills/poteto-mode/playbooks/feature.md)、[Opening a PR](https://github.com/creedants/pstack-t3/blob/dd15e6301eb6bbd04866a5091f50f801fbb2a5ed/skills/poteto-mode/playbooks/opening-a-pr.md)。

## 4. 长期使用的关键：常驻协调器

`$brigade` 创建并固定一个项目协调线程。后续在这个线程直接提出普通需求，协调器会沿用已保存的项目目标和规则。

一次工作通常经历：需求入队 → 划定范围与依赖 → 工作区负责人执行 → 返回报告 → 协调器检查 diff 和基础检查 → 独立验证者审查 → 通过或返工 → 进入交付队列。

其主要持久材料包括：

- `menu.md`：项目目的、完成标准、范围、预算说明。
- `house-rules.md`：长期规则，生成工作任务简报时会带入。
- `rail.tsv`、`dishes.tsv`：需求与执行单元。
- `pass.tsv`：审查结果。
- `86.tsv`：等待用户决策的事项。
- `reports/`：工作与审查报告。

默认存储在 `${XDG_STATE_HOME:-~/.local/state}/pstack-t3/` 下，不需要把临时执行记录塞进源码仓库。调度和任务完成通知用于恢复执行、收报告和发现卡住的任务；它们依赖 T3 服务、凭据和机器继续可用。

有几项具体保护比单纯“请认真审查”更有价值：

- 有写入的工作分配独立工作区，并管理路径租约，降低多个任务同时修改同一范围的问题。
- 常驻协调器本身不写功能代码。
- 验证者优先使用与实际代码作者不同的模型家族，审查绑定具体提交。
- 常驻协调流程中，代码变化或发生改变的 rebase 需要重新验证相应结果。
- 连续三次审查退回后进入决策状态，选择接受已知限制、重新设计、放弃或暂存，避免无限修补。

“只读审查”主要由任务简报约束，不能等同于每位审查者都有强制隔离的只读系统权限。

来源：[协调器使用说明](https://github.com/creedants/pstack-t3/blob/dd15e6301eb6bbd04866a5091f50f801fbb2a5ed/docs/guide/coordinator.md)、[状态与汇报](https://github.com/creedants/pstack-t3/blob/dd15e6301eb6bbd04866a5091f50f801fbb2a5ed/docs/guide/reporting.md)、[审查实现规则](https://github.com/creedants/pstack-t3/blob/dd15e6301eb6bbd04866a5091f50f801fbb2a5ed/skills/brigade/reference/review.md)。

## 5. 对照需要的七个阶段

| 阶段 | 可以复用的机制 | 需要保存的项目约定 | 判定可以进入下一步的证据 |
| --- | --- | --- | --- |
| 需求 | 协调器 intake、menu、Multi-phase-plan | 目标用户、场景、范围、排除范围、验收条件；仅关键歧义需要用户决策 | 可检查的需求清单与验收条件 |
| 调研 | Investigation、how、why、只读研究任务 | 现有代码调查与外部方案调研分开；联网来源、比较维度、未知项、结论依据 | 有来源和约束的比较结论 |
| 设计 | architect、候选方案比较、计划检查 | 技术方案、接口、数据模型、失败路径；如涉及 UI，补充交互/视觉设计与确认点 | 选定方案、取舍、必要原型或界面证据 |
| 开发 | 负责人、独立 worktree、依赖和并行拆分 | 代码范围、共享文件、实现顺序、项目 AGENTS 规则 | 可审查 diff 与实现报告 |
| 单测 | tdd 与项目测试命令 | 哪些行为必须有测试；逻辑 Bug 要有先失败后通过的回归证据；不强塞无意义测试 | 实际命令、结果、对应验收条件 |
| Code Review | brigade verifier、light gate、full interrogate | 审查者与作者分离，检查正确性/边界/测试；需执行验证的发现提供证据 | 具体提交上的 pass 或明确阻塞项 |
| E2E | create-verification-skill、现有 Playwright/Cypress、T3 Preview/设备工具 | 业务关键路径、登录和测试数据、界面/设备、结果及副作用断言、证据与清理 | 真应用上的执行结果、截图/录像/日志及必要数据检查 |

三处不能仅凭名字误判：

1. `why` 主要解释“现有系统为什么如此设计”。full 模式会调查 git/PR、工单、文档、团队聊天、监控、异常、分析数据等可用来源；light 默认只保留源码历史调查。它不是自动完成竞品、市场与全网选型调研的保证。
2. `architect` 主要覆盖技术结构，不等于完整的产品设计或 UI/UX 流程。
3. `tdd` 明确是按需求或有廉价局部测试目标时启用，不会保证所有任务都新增单测。测试标准需要显式固定。

验证 Skill 会识别项目启动和驱动方式，优先利用现有测试工具，并记录 Launch、Doctor、Drive、Evidence、Cleanup。生成后必须实际走通至少一条完整路径，未运行的只能算草稿。它不自动保证已生成覆盖全部业务的、可在 CI 中长期执行的 E2E 测试套件。

来源：[why](https://github.com/creedants/pstack-t3/blob/dd15e6301eb6bbd04866a5091f50f801fbb2a5ed/skills/why/SKILL.md)、[architect](https://github.com/creedants/pstack-t3/blob/dd15e6301eb6bbd04866a5091f50f801fbb2a5ed/skills/architect/SKILL.md)、[tdd](https://github.com/creedants/pstack-t3/blob/dd15e6301eb6bbd04866a5091f50f801fbb2a5ed/skills/tdd/SKILL.md)、[生成验证 Skill](https://github.com/creedants/pstack-t3/blob/dd15e6301eb6bbd04866a5091f50f801fbb2a5ed/skills/create-verification-skill/SKILL.md)。

## 6. Codex + Claude Code 接 DeepSeek 的分工建议

以下是适配建议，不是软件自带的默认配置，也不是模型质量评测结论。

| 工作 | 起步建议 |
| --- | --- |
| 常驻协调、需求收敛、最终取舍 | Codex；尽量保持协调线程不直接写功能代码 |
| how、资料收集、局部实现、测试编写 | 已配置的 DeepSeek 实例，按实际工具能力验证后使用 |
| architect runners | 先一个 Codex 设计者提供两种方案，复杂问题再增加另一模型的独立方案 |
| feature, refactoring / bug-fix | DeepSeek 作为初始实现者 |
| verifiers / Code Review | 由 Codex 独立审查 DeepSeek 写的代码 |
| E2E | 有相应工具的验证者实际驱动应用；模型名称本身不决定工具是否齐全 |

若某个任务实际改由 Codex 编写，则要为其选择另一家族的验证者，或明确记录只能同家族审查的降级。跨家族是额外的审查分离措施，不能替代可执行证据。

角色位保存在用户 `~/.config/pstack-t3/roles.json` 或项目 `.pstack/t3-roles.json`。项目设置可以覆盖对应用户角色。每个角色最终指向真实 T3 `providerInstanceId`、`model` 和可用选项。未设置的角色通常继承父线程；仅安装并不会自动混用两种模型。

当前 DeepSeek 实例已知标识是 `claudeAgent_deepseek`，模型标识 `deepseek-flash`。不要因为使用 Claude Code 运行就填写一个 Claude Sonnet/Opus 模型名。pstack 按规范化模型 ID 的前缀区分家族，`deepseek-*` 与 `gpt-*` 可被区分；仍需用实际 `orchestrator_capabilities` 验证模型是否存在、实例是否能运行子任务，再进行最小委派验证。

全局安装到 Claude 侧时要注意当前使用的独立配置目录 `/Users/hx/.claudedeepseek`。安装器会在用户安装且设有 `CLAUDE_CONFIG_DIR` 时使用该目录，否则通常落到默认 `.claude`。不能只装到默认目录就假定 DeepSeek 实例已经加载了 Skill。

来源：[角色配置](https://github.com/creedants/pstack-t3/blob/dd15e6301eb6bbd04866a5091f50f801fbb2a5ed/skills/pstack-runtime/roles.md)、[角色解析](https://github.com/creedants/pstack-t3/blob/dd15e6301eb6bbd04866a5091f50f801fbb2a5ed/t3/scripts/_roles/seats.py)、[安装目录逻辑](https://github.com/creedants/pstack-t3/blob/dd15e6301eb6bbd04866a5091f50f801fbb2a5ed/scripts/_install/layout.py)。

## 7. 怎么固定流程，避免重复提示词

建议保存四类东西：

1. 模型角色配置：谁调研、谁设计、谁实现、谁验证。
2. 协调器常驻规则：七阶段的产物、先后关系、允许跳过的条件、返工规则、预算和汇报方式。
3. 项目验证 Skill：如何启动、登录、准备数据、驱动用户路径、检查结果、留证、清理。
4. 交付规则：当前项目是否允许 PR、由谁合并、哪些检查必须通过。

可以放入常驻规则的要求示例：

> 新功能先形成需求及验收条件，再完成相关代码调查和必要的外部方案调研，选定设计后实现。单测应证明关键行为，逻辑 Bug 保留失败前与修复后证据。代码由独立模型审查。关键用户路径必须在真实应用执行 E2E，并核对必要副作用。缺失证据的验收项不得标为完成。只有与当前变更有关的阶段需要执行；不适用时写明依据。仓库 AGENTS 对提交、PR、测试和数据的规定优先。工作完成报告列出需求与验证证据的对应关系。

这是保存后的长期指令，不用每次发。若需要“缺少某一阶段材料时系统绝不允许过关”的硬性约束，还应把阶段完成检查做成薄的校验脚本或 CI 检查，并接入已有检查命令。它自身对角色、任务、审查和 landing 有程序化检查，但没有现成的、覆盖用户这七阶段全部产物的通用硬门禁。

以后正常输入的需求可以很短，例如：“增加管理员批量邀请成员功能，支持邮件邀请和结果汇总。”协调器读取常驻规则后仍需要从这句话具体化需求和验收；影响产品决定的真正歧义不会被凭空解决。

## 8. 使用 light，按任务升级 full

当前源码的缺省模式是 `light`。它保留代码委派、决定能否交付的检查和独立审查，减少周边 Agent 数量。例如设计由一个 runner 提出两个结构不同的方案，常规调查减少子任务，swarm 一波最多三个 worker。这里的三个不等于整个项目所有嵌套线程的统一上限；协调器负责人并发另有 worker cap。

light 不能成为跳过用户要求的需求、调研、单测或 E2E 的理由；这些要求要明确写入本项目的工作契约。复杂设计争议、高风险改动或有明确比较价值时再升级 full。

`budget` 主要限制模型推理档位，不是金额、Token、执行时长或总并发的硬限制。要控制开销，应另设负责人并发、候选数、审查者数量、返工轮数和需用户决策的条件。

项目维护者公开的一次旧版 full 运行处理了四个小 Python 工作项，最终共启动 61 个线程，从启动到最后 PR 合并用了 109 分钟。这是维护者在自己测试仓库的个案，且版本、模型和规则与当前不同；不能拿来预测当前项目成本，但说明全面扇出可能很重。

来源：[light 规则](https://github.com/creedants/pstack-t3/blob/dd15e6301eb6bbd04866a5091f50f801fbb2a5ed/skills/pstack-runtime/light.md)、[模式解析](https://github.com/creedants/pstack-t3/blob/dd15e6301eb6bbd04866a5091f50f801fbb2a5ed/skills/pstack-runtime/SKILL.md)、[维护者运行记录](https://github.com/creedants/pstack-t3/blob/dd15e6301eb6bbd04866a5091f50f801fbb2a5ed/docs/live-runs.md)。

## 9. 交付和当前仓库规则

内置 landing 支持 `merge`、`human`、`push`、`local` 四种模式。`human` 创建 PR 后由人合并；`local` 只移动本地 landing ref，不改真实 trunk 或远程；`merge` 自动走 PR 合并；`push` 可直接推送 trunk。模式属于整个仓库，多个协调器共享。

当前 t3code 的 AGENTS 明确要求未被显式要求时不能创建 PR。因此不能直接照抄普通 Feature 的 Opening a PR 或常驻协调器的自动交付行为。若未来在本仓库试用，应明确本地验收交付的范围，选择相符的 local contract，并确认工作任务简报不会执行默认 PR 行为。其他项目则按各自仓库规则选择 human 或其他模式。

官方文档要求 T3 0.1.3+、Python 3.10+；GitHub 相关操作需要对应工具和认证。此前可用的 DeepSeek 单次对话证明了 API 连接，不证明跨模型委派、调度、项目验证和 pstack 全链路已通过。

来源：[交付模式](https://github.com/creedants/pstack-t3/blob/dd15e6301eb6bbd04866a5091f50f801fbb2a5ed/docs/guide/reporting.md)、[安装前提](https://github.com/creedants/pstack-t3/blob/dd15e6301eb6bbd04866a5091f50f801fbb2a5ed/docs/guide.md)。

## 10. 建议的落地次序

先验证 T3 实际工具和两个实例的最小跨模型委派，再创建一个常驻协调器，保存七阶段规则，接好一个项目验证 Skill。以一个完整小功能验证“需求收敛 → 调研 → 设计 → 实现与测试 → 独立审查 → 真实 E2E → 本地验收”的闭环，再扩大并行规模。

这一步骤是实施建议，本次未执行安装、创建协调器、付费多 Agent 调用、仓库修改、PR 或自动合并。
