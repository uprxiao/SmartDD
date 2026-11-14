# 合法能力快照与绑定迁移独立验证

日期：2026-11-14。关联 R08／R10／R12、Q13／Q48，设计口径见[技术方案 §3.2](../../技术方案.md#32-旧能力表的迁移方向)。本次运行真实 SmartDD Schema、能力会话注册器、资源库、运行计划校验与 GC 计划器，使用隔离 SQLite／临时文件及受控应用包；没有改业务源码、真实数据库或执行资源删除。

## 证据与边界

[build.mjs](build.mjs) 打包现有 TS 服务；仅将 Vite 的原始 SQL／静态资源 glob 替换为实际文件内容，未替换服务运行逻辑。完整构建来源 hash 在 [build.json](build.json)，关键源码与依赖版本见 [sources.json](sources.json)。使用当前全部 bundled migrations 初始化临时库；本次没有调用正式应用升级入口或执行 Electron。

[probe.mjs](probe.mjs) 复用现有 runFixture／PackageRegistry／RuntimeRegistry 安装受控包。最终夹具将工具名选为实际受信映射 `smartdd_zentao_object_get_v1`，只有测试 Skill／适配器／空桥文件，不调用真实禅道、模型或业务端点。v2 包含真实临时 Skill 投影；v3 使用现有库模式允许的空 skills，能力合同来自实际 builtin module。第二个旧任务用于构造合法 v3 基线，不作为用假 taskId 实现多绑定的方案。

[candidate.mjs](candidate.mjs) 只是版本化外层记录／四张候选关联表：原合法 v2／v3 内容不加字段，外层保存 task／binding／capabilitySession／contentHash；校验复合关联和所给资源引用的身份。它**未实现**完整快照注册器：不验证必需引用是否齐全、不协调投影发布、不统一新旧 native／MCP 冲突域、不调业务权限、不实施完整 run 表迁移或资源回收。因此不能直接放进生产，也不能把同内容的两份历史关联当成可同时执行的两份能力会话。

## 批次与结果

- [attempt-1](attempt-1/result.json)：记录 3 项通过、9 项失败。根因是通用测试夹具的旧工具名不在真实禅道受信映射里，导致 B02／B04 失败及后续依赖失败；不是业务功能缺陷。检查代码同时修正 B10 的 finally 回滚会遮蔽断言错误的问题。此批不用于证明整体合同；原脚本和结果保留。
- [attempt-2](attempt-2/result.json)：12 项均满足预期。按真实受信映射构造包；B10 在断言完成后才抛回滚哨兵，错误断言不再被覆盖。B11／B12 是**故意复现未迁移旧服务的反例**，通过表示确认风险，并不表示生产问题已修好。

| 检查 | 已实际证明的范围 |
| --- | --- |
| B01–02 | 合法 v2／v3 经真实 create/get 读取；包／桥／适配资源有真实引用；v2 Skill 文件存在。v3 externalPlugins 缺省和显式空数组均合法，但规范摘要不同 |
| B03 | 旧严格 Schema 拒绝新增 bindingId；同任务另一快照被原注册器拒绝，旧内容保持 |
| B04 | 原生 sessionId 从 null 绑定后内容摘要改变，selectionHash 保持，原历史版本保留；旧运行计划的特定来源例外仍可核对 |
| B05 | 旧 run-plan-v1 拒绝直接加 bindingId；改变选择内容不能借用首次原生绑定例外 |
| B06 | 原注册器拒绝 MCP 名称和原生身份冲突；未验证新旧注册器联合并发 |
| B07 | 候选外层记录保存两份 v2 修订及合法 v3，原表不变、旧读路径仍可用；不是完整生产迁移 |
| B08 | 相同 contentHash 可以对应不同历史关联；授权查找必须同时核对 task／binding／capabilitySession。错 scope／篡改内容拒绝；这不授权复制原生身份或投影目录 |
| B09 | 候选复合外键拒绝跨 task／binding；给定引用的 hash／类型／路径与真实资源不符时拒绝；foreign_key_check 无问题 |
| B10 | 真实 reader 拒绝错误摘要、缺资源引用、缺 MCP 名称；每个故障在临时事务回滚，正常快照仍可读取 |
| B11 | 真实 GC 计划器保护旧 tombstone 引用；去除旧表引用、只保留候选引用时却给出 canCollect=true，issues=[]。没有执行删除；证明须同步升级回收入口 |
| B12 | 原版本只留在新表后，真实运行计划来源函数无法读到它并拒绝；证明必须覆盖历史版本查询，不能只改当前快照查找 |

最终合法快照、运行计划、候选外层记录和两份 GC 计划保存在 attempt-2。临时库与夹具目录已由 fixture cleanup 清理；没有归档日常数据、秘密、依赖目录或生成 bundle。重跑需在隔离目录准备 sources.json 对应依赖，按本地仓库位置调整 build.mjs 的 repo/root 后运行 `node build.mjs`、`node probe.mjs`；不能把此脚本接到正式库上。

## 外部插件语义的源码核对

`shared/plugin-session.ts` 明确 packageHash 是启动审计身份；`plugins/session-tools.ts` 的 current/build 使用当前安装并启用的版本，再检查启动能力的 permission／semantics／slots、当前运行身份与政策。`plugins/lifecycle.ts` 通过 withInvocation 和插件租约协调在途调用／更新。因此外部插件不应仅因出现在快照里，就改成按旧 hash 强制执行旧包；内置包、共享 Skill 库及外部插件需分别保持现有生命周期。

这一段是源码证据，**本轮没有执行插件升级、停用、卸载或真实在途调用**；也没有把 externalPlugins 缺省／空数组测试当成插件功能已验证。

## 后续仍须验证

生产迁移器、启动排他／旧入口并发、完整 run 关联与历史修订回填；新旧统一 native／MCP 唯一性、投影路径及原子发布；完整引用／依赖闭包与最终删除复核、资源更新／hold／tombstone；新 run-plan 版本／绑定上下文和业务桥；插件实时政策、真实 Skill／MCP、原生恢复、崩溃、回退及跨平台。Q13／Q48 保持部分，产品验收仍为 0／54。
