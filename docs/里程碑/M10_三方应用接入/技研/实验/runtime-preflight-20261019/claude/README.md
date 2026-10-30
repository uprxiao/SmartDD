# Claude Code／cdsh 开发前机制验证

2026-10-19，macOS arm64；对应需求12.20／A19第一阶段。结果为 **3个真实模型调用场景通过，用户配置合并等边界另验**，不是M10正式业务验收。

用户指定使用已有 `cdsh`，本机该别名仍调用Claude Code；实际CLI为 **2.1.303**，配置模型标识为 **`deepseek-flash`**。用户描述为DeepSeek 4.1 Flash，本实验只确认配置及CLI初始化回报，不推断服务商底层模型版本。它属于Claude适配器的另一套模型服务配置，不是DeepSeek Harness（DSH）适配验证。

## 实际路径和加载方式

探针脚本：[probe.py](probe.py)。本机原始证据保留在仓库忽略目录 `release/m10-research/runtime-preflight-20261019/claude/`，下称 `E`。测试不读取禅道、邮件或真实项目业务数据。

| 对象 | 实际实验位置／参数 |
| --- | --- |
| 项目工作目录 | `E/project-a/` |
| 原生会话根 | 子进程 `CLAUDE_CONFIG_DIR=E/native-state`；HOME未改 |
| v1完整插件 | `E/packages/1.0.0/plugin/` |
| v2完整插件 | `E/packages/1.1.0/plugin/` |
| Skill与引用 | 各插件 `skills/version-check/SKILL.md` 和 `references/check.json` |
| 每次MCP配置 | `E/<场景>-mcp.json`；Python stdio工具只校验合成nonce并返回版本 |
| 加载／恢复 | `--plugin-dir <所选版本插件>`、`--mcp-config <本次配置>`；初建指定session ID，恢复传同一ID的`--resume` |

每次提示仅明确调用 `/wy-preflight:version-check`，没有提供引用nonce或预期版本答案。Skill要求模型显式Read对应引用文件，再用该nonce调用 `mcp__wy_probe__version_check`。结果同时核对初始化发现列表、Skill工具事件、精确引用路径、MCP服务端实际收到的nonce及返回版本，不能只凭模型一句“已加载”判断成功。

为防实验调用用户原有工具，本轮使用 `--setting-sources ''`、`--strict-mcp-config`、关闭hooks，仅允许Skill／Read和本合成MCP工具；**这些是隔离实验参数，不是生产推荐参数**。探针只读取既有cdsh静态分支，将凭据放入子进程环境，不在脚本、MCP配置或公开结果中保存值；没有执行`claude_with_account`包装函数。

过程记录：前期检查shell配置时曾有一次脱敏不完整的工具输出，已向用户说明并停止输出配置正文；本目录报告与证据不收录这些值。不能将后续探针的凭据处理方式表述为整个操作过程从未发生输出问题。

## 执行结果

| 场景 | 真实观察 |
| --- | --- |
| 新建v1 | 发现Skill，调用Skill，显式Read v1引用，MCP返回1.0.0且nonceMatch=true |
| 恢复同一v1原生会话 | native session ID与上次相同；再次Skill／Read／MCP，返回1.0.0 |
| 并发新建v2 | 新native session ID；Skill／Read／MCP均指向v2，返回1.1.0 |
| 两版本并发 | v1恢复与v2新建的子进程调用区间实际重叠约1.63秒；两个版本在启动前都已准备 |
| 默认配置保留 | 测试前后 `~/.claude/settings.json`、`~/.claude.json`、`~/.codex/config.toml` 内容哈希相同 |
| 合成用户Skill | 放在隔离原生根的用户Skill未出现在上述发现列表；空setting-sources不能证明用户能力保留 |

结构化结果：[result.json](result.json)。[collect_results.py](collect_results.py)再次从原始事件核对精确路径和版本，并记录原始文件哈希。最初v1成功时尚未加开始／结束时间和脚本hash字段，故该次不声称有同步采集的源hash；恢复与v2结果含对应源hash。当前脚本hash记录仅用于恢复实验，不倒推补造初次证据。

失败尝试单独保留：REA子进程没有继承shell认证；受限网络EPERM；原默认服务联网后402订阅额度不足。用户改用cdsh后以上三场景成功，未修改账号、计费或全局认证。REA最初无认证捕获ID为 `ev_0f0840ce13da1476a1d48ed97cc0489286e169c931554e46c30ac1b1954a856c`，不能把其包装器exit=0解释为模型成功。探针总时限75秒，超时仅结束自己的进程组；本轮成功路径没有触发超时回收。

## 对设计的含义与限制

1. 当前CLI支持把完整Skill树作为指定插件载入，并在重新启动／原生resume时继续引用同一目录。**固定版本由WillYou保存快照并再次提供正确路径保证，原生resume本身不替WillYou锁版本。**
2. 需要同时保留Skill引用树与对应工具实现；只保存SKILL.md文本、却把MCP悄悄换成新版，不能达到本实验的一致结果。
3. 原生会话根虽然隔离，HOME变量未变；这不能证明常规用户Skill／MCP合并、项目配置、全局目录交叉发现或用户旧历史恢复。相应补查单列，生产默认不使用空setting-sources或strict MCP清空用户能力。
4. 只验证显式请求的三个短turn，无自动Skill选择、长对话压缩、终端TUI、真实应用升级、broker权限、数据库迁移或SMTP结果。`result.json`的通过仅覆盖该表合成机制子场景，不把T50–T56整条产品用例改为通过。

复查已有证据可运行 `python3 .../claude/collect_results.py`，不调用模型。`probe.py old/new --profile cdsh`会真实调用既有模型服务且写固定场景文件，重新执行前须归档原证据；`--resume`依赖原场景身份。本轮保留失败和成功原件，没有把失败改写成成功。
