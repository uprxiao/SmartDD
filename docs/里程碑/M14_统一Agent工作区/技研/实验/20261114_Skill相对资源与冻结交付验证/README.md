# Skill 相对资源与冻结交付验证

日期：2026-11-14。关联 R07／R08、Q08／Q40。设计见[技术方案 §7.3](../../技术方案.md#73-skill-交付更新与调用来源)。运行真实 Claude SDK 0.3.321／native 2.1.321 和 Codex 0.167.1，模型为本机可控 HTTP 替身，HOME、项目、配置和包数据均隔离；没有使用真实供应商／用户 Key、修改业务代码或迁移日常数据库。

## 实际执行的服务

[build.mjs](build.mjs) 打包实际 `runFixture`、`PluginPackageStore`、`FrozenPluginSkills`、`capturePluginSession`、`syncAgentSkillLibrary` 等 TS 实现，Vite glob 仅替换为原始 SQL／资源内容；[build.json](build.json) 保留完整来源 hash。[probe.mjs](probe.mjs) 构造合法受控插件包，Skill 子树包含 SKILL.md、scripts/run.sh、references/version.txt，并保留脚本执行权限。

FrozenPluginSkills 使用实际包库；传入的 lifecycle 门面只提供 packages，不是假装执行了 PluginLifecycle 的安装、启用、更新或卸载流程。prepared run 行由夹具建立，用来满足真实 materialize 的归属校验；没有 attach native owner 或接真实业务桥。源包通过 publish／removeUnused 替换，不等同于完整插件升级验收。

原生程序版本、来源源码及 SHA 见 [sources.json](sources.json)。Codex 的 extraRoots/set、forceReload 和 typed skill 输入均调用真实 app-server；Claude 使用实际生成的局部插件 wrapper 和 Skill 工具。假模型明确选择 Skill／脚本，只证明传输、加载及工具执行能力，不能证明真实模型会自主选用或遵循协作方法。

## 批次

- [attempt-1](attempt-1/result.json)：文件交付 L01 通过，外层沙箱拒绝监听 127.0.0.1（EPERM），未执行原生回合。保留环境失败，不计 SDK 不兼容。
- [attempt-2](attempt-2/result.json)：在获准的隔离环境执行，L01–10 全部满足预期；共 8 个原生回合，3 个 Claude 进程和 1 个 Codex app-server 均退出 0，见 [cleanup](attempt-2/cleanup.json)。没有安装全局 CLI。
- [关联审计](attempt-2/audit-result.json)：[audit.mjs](audit.mjs) 离线检查记录，将每轮新 Skill 展开和新 Bash／exec_command 的调用 ID 与返回值匹配，8 轮均确认当前调用成功；旧历史输出不能作为本轮成功依据。L09 两回合共用日志 phase，审计按每轮 count=1 切分，不能按 phase 名简单合并。

| 检查 | 结果与边界 |
| --- | --- |
| L01 | 实际冻结服务为两执行器生成独立路径／名称，保留 Skill 相对资源和脚本 owner-executable 位；包外 `.mcp.json` 未进入 payload。夹具含 hooks，但没有触发钩子执行测试 |
| L02–03 | Claude Skill 工具／Codex extraRoots＋typed skill 把正文与 base path 送入假端点；原生 Bash／exec_command 执行冻结脚本，读出 RESOURCE_0.1.0 |
| L04 | 发布 0.2.0 并移除源 0.1.0 包后，两个 0.1.0 冻结副本仍通过完整性校验；新副本属于不同 run 并包含 0.2.0 |
| L05–06 | Claude 新进程 resume 原 session、Codex 同进程同 thread 再调用旧冻结 Skill，仍实际执行 0.1.0 资源；不是把旧输出当成功 |
| L07–08 | 两执行器的新冻结副本实际展开及执行 0.2.0；没有证明所有历史原生插件配置会自动刷新 |
| L09 | 实际共享库同步 0.1.0→0.2.0；显式设置 roots／forceReload 后，同一 Codex thread 的新 typed skill 输入和新工具输出采用 0.2.0。**没有验证省略刷新时、文件监视器自动刷新或 Claude 共享库热更新** |
| L10 | 真实 release 拒绝 prepared 行；所有捕获的 native 退出后，夹具将行置 stopped，原目录被释放。不是生产 owner／后台范围清理完成的证明 |

压缩原生帧、模型请求、决策及 stderr 在 attempt-2，gzip 原文 hash 在 sources.json。文件内容全部来自受控夹具；生成 bundle／依赖／SQLite／运行 HOME 没有入库。测试关闭了本轮捕获的进程和端点，资源夹具由 cleanup 清理；原生记录仍位于隔离临时 attempt 目录。

## 设计结论

1. 保留现有完整目录交付：Skill 正文、相对脚本／资源及执行权限一起处理，不能只复制 SKILL.md 或只保存文字摘要。相对引用由真实 Skill base path 定位，不改成项目 cwd。
2. 冻结副本和共享库更新是两种合同；UI／启动记录应说明采用哪种。相同逻辑任务／原生 thread 不保证内容永久不变，刷新及下一运行的采用规则须明确。
3. 外部插件 **Skill 文件按 run 冻结**，但 **业务调用实时核对当前插件状态和政策**（源码核对）；保留旧指令不能使已卸载／停用的业务工具继续获权。新 SDK 路径须保留这一区别。
4. 原生调用方式留在 Driver：本轮实际验证 Claude Skill 工具与 Codex typed skill。T3 的 ClaudeSkillDispatch 另处理文本块开头斜杠调用、多 mention 及 userInvocationOnly；该模块本轮只读核对，不能将 Skill 工具成功推广到这些 UI 分支。

## 尚未通过的范围

真实模型自主使用 Skill／调宿主委派、统一 UI 选用入口、Claude 斜杠和 userInvocationOnly、多 Skill／同名冲突、缺失／损坏相对资源、native 运行中移除或替换、共享库不刷新行为、完整插件生命周期／业务授权、多绑定 owner／投影回收、Windows／Linux。Q08／Q40 保持部分；产品验收仍为 0／54，不把 10 个研究检查或 8 个原生回合算作产品通过。

重跑须在隔离目录准备 build.json／sources.json 对应的依赖与两执行器，按本地位置调整 build.mjs、probe.mjs 的绝对路径；先 `node build.mjs`、`node --check probe.mjs`，再在允许本机回环监听的环境执行 `node probe.mjs`。audit.mjs 的 attempt 路径须明确指向本次原始记录；不要读取日常 HOME 或接入真实模型。
