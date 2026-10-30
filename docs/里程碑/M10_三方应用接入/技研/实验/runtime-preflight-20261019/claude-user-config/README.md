# Claude Code：真实用户配置与原生恢复补验

2026-10-19，macOS arm64，Claude Code **2.1.303**；使用用户指定的 `cdsh` 兼容服务配置，实际模型标识 **`deepseek-flash`**。本轮完成真实默认根的配置共存、精确名称冲突和自有原生会话恢复补验。[结果汇总](result.json)的 **18 条断言通过**，其中包括对危险同名覆盖行为的负面事实断言；不表示同名覆盖可接受，也不表示正式 WillYou 已实现预防机制。

## 环境与实际路径

这次没有复制用户配置、没有改 HOME、没有设置 `CLAUDE_CONFIG_DIR`、没有使用空 `--setting-sources` 或 `--strict-mcp-config`。CLI 直接读取本机原配置：

| 对象 | 本次实际位置 |
| --- | --- |
| HOME／原生配置目录 | `/Users/liubu`／`/Users/liubu/.claude` |
| 用户设置 | `/Users/liubu/.claude/settings.json`、`settings.local.json` |
| 用户 MCP 定义及原生状态 | `/Users/liubu/.claude.json` |
| 自有合成项目 | `<仓库>/release/m10-research/runtime-preflight-20261019/claude-user-config/project-a/` |
| 自有应用 Skill | 上述实验目录的 `packages/1.0.0/plugin/skills/version-check/SKILL.md` |
| Skill 引用文件 | 同目录 `references/check.json` |
| 自有会话原生 ID | `a124d47e-906f-44b7-85f6-d36e922cbc7f` |
| 真实原生会话文件 | `/Users/liubu/.claude/projects/-Users-liubu-Documents-ChatGPT-SmartDD-release-m10-research-runtime-preflight-20261019-claude-user-config-project-a/a124d47e-906f-44b7-85f6-d36e922cbc7f.jsonl` |

完整参数、CLI 二进制 hash、执行脚本 hash、时间和原始证据 hash 见各场景 JSON。常规应用注入仍使用 `--plugin-dir <版本目录>` 与 `--mcp-config <本次合成配置>`；新建指定 `--session-id`，恢复使用同一 ID 的 `--resume`。会话保留在真实原生目录，没有恢复、修改或删除用户日常历史。

## 已观察到的结果

| 场景 | 实际结果及证据 |
| --- | --- |
| 原配置＋独立应用名称 | [inventory-result.json](inventory-result.json)：190 条命令，6 个原有用户 MCP 均保留，自有 MCP 已连接 |
| 不注入应用的对照 | [baseline-result.json](baseline-result.json)：189 条原有命令；与上项按名称、描述 hash 和重复次数比较，全部保留，应用只增加一条命令 |
| 精确同名冲突 | [collision-result.json](collision-result.json)：同时构造插件名、MCP 名碰撞，分别取得下述覆盖证据；没有调用冲突工具 |
| 真实模型新建 | [real-new-result.json](real-new-result.json)：仅 `Skill → Read 精确引用 → 自有 MCP`；返回 `1.0.0`、`nonceMatch=true` |
| 真实模型原生恢复 | [real-resume-result.json](real-resume-result.json)：新进程使用同一原生 ID，重新执行 Skill、Read 和 MCP，仍返回上述版本与正确 nonce |

两轮实际模型均没有调用原有用户 MCP、其他 Skill、其他文件读取或 shell 工具。两轮只读的是实验合成文件，MCP 不访问真实禅道、邮件或其他业务资源。原生会话文件存在且可由同一 ID 恢复；“锁定版本”仍依靠启动方重新传入同一插件目录和匹配 MCP，不是原生会话 ID 自带版本锁。

原有 6 个 MCP 的名称、来源与已发现工具列表在正常注入时保持一致。`chatlog`、`crawl-mcp`、`voicemode`、`clawchat`、`rea` 已连接；`playwright` 在有／无注入的有限发现窗口中都仍为 `pending`。因此证明的是配置／能力没有被应用覆盖，不能写成“全部用户 MCP 服务健康”。未调用用户业务工具以证明连接健康。

原目录还存在一个重复的 `lovstudio-write-professional-book` 命令名（189 条记录、188 个唯一名称）；本轮完整保留该既有状态，没有替用户清理。整理脚本初版错误将记录数等同唯一名称数，造成一条假失败，已改用多重集合比较；原结果保留在 [attempt-01-collector-duplicate-name.json](attempt-01-collector-duplicate-name.json)，无需重跑 Agent。

## 同名冲突：必须进入实现的规则

1. **插件名称碰撞会替换整套插件能力。** 本轮把命令行插件的 manifest.name 设为用户已有的 `understand-anything`，提供相同完整命令 `understand-anything:understand`。实际发现该命令变为合成描述，原插件另外 **7 条命令消失**，命令总数由 190 降到 183。不是只影响一条同名 Skill。
2. **MCP 名称碰撞会替换用户服务。** 本轮 `--mcp-config` 再声明用户已有的 `chatlog`。该名称由 `source=user`、原有 4 个工具，变为 `source=dynamic`、仅合成 `version_check` 工具。原磁盘配置没改，但本次运行的有效能力已经变了。
3. **不应依赖原生合并优先级保护用户。** WillYou 适配器必须先核对有效插件 namespace、完整 Skill 名称与 MCP server key。受管名称使用自己的稳定命名空间；发现碰撞时，这个应用整体不注入，给出明确配置冲突提示，让 Agent 按原有配置继续启动。不覆盖用户能力，不偷偷改名绕过冲突，也不清空全部用户配置。此处是根据真实证据确定的实现契约，守卫的正式实现及 UI／PTY 验收属于开发阶段。

实验结束后的无注入对照再次发现原 189 条命令及 6 个 MCP，说明实验覆盖仅限其进程启动参数，没有将合成插件安装进用户全局配置。

## 配置、认证和证据处理

- `settings.json`、`settings.local.json` 前后字节 hash 相同。`.claude.json` 内容 hash **发生变化**，变化字段仅 `pluginUsage`、`skillUsage`；这是 CLI 记录自己的使用状态。其余字段（包含 MCP 定义）语义 hash 不变。没有回写整个文件“恢复 hash”，避免覆盖并发使用。
- 为限制探针副作用，本轮通过单次 `--settings` 设置 `disableAllHooks=true`，关闭自动更新／非必要流量；保留正常设置来源。用户 hooks 的实际执行兼容性不在本轮通过范围。工具权限只允许合成调用路径，并禁止原有用户 MCP 工具调用。
- 沿用之前已审核的 `apply_cdsh()`，只静态读取明确 profile 分支，将认证放入子进程环境。没有执行 shell 包装函数，没有把认证写入脚本、配置文件、报告或 stdout。
- 本轮公开和忽略目录的新证据已扫描已知 cdsh 认证值，未发现匹配；不据此声称能够检测所有未知敏感信息。原始事件只保留在 `release/m10-research/runtime-preflight-20261019/claude-user-config/`，不提交；文件权限设置为 `0600`。公开结果仅保留所需命令名、字段名、hash、工具名称、测试标记与状态。
- 五个场景的主进程均已退出。自有探针会话和合成包保留，以便核对恢复证据；没有删除或恢复用户日常会话。

## 复现、开发准入与边界

只整理现有证据、无需模型调用：

```sh
python3 -B docs/里程碑/M10_三方应用接入/技研/实验/runtime-preflight-20261019/claude-user-config/collect_results.py
```

实际探针入口是 [probe.py](probe.py)，参数为 `baseline`、`inventory`、`collision`、`real-new`、`real-resume`。后两项会调用已授权模型服务、写入自有原生历史；重新运行前应归档现有结果，不能把再次运行覆盖当作同一次证据。前四次执行源归档为 [probe-initial.py](probe-initial.py)，后来只添加无注入 `baseline` 模式并缩减控制台输出；结果中的源 hash 都可对应到已保存脚本。

**CC 的这一项开发前疑问已得到足够实施依据：真实用户配置可共存、原生恢复可用、危险同名优先级已明确，并有对应防护契约。** 本结论限于上述版本、profile、本机实际用户设置和短合成会话。未覆盖互动终端 TUI、用户任意历史长会话、用户 hooks 执行、其他 CLI 版本和全部配置排列；这些不能扩写成“所有 CC 配置兼容”。实际 WillYou 打包启动、PTY、broker 权限、版本升级／回收和异常恢复仍按开发后的用例验收，不因此把完整产品用例改成通过。
