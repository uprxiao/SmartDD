# T065 三版源码复用审查

本轮只做静态 U 级证据核对，没有运行 helper、App、PTY、监听或构建，也没有修改生产代码、公共账或旧交付。按完整 patched CLI 源码核对后，原 75 个场景中有 71 个可由当前证据与精确路径复用支撑，另外 4 个必须补测。独立 attempt-006 已在同一 `.4` 宿主完成这 4 项，全部通过；最终建议协调者按下表组合验收。

| 证据 | 原矩阵场景数 | 使用依据 |
| --- | ---: | --- |
| attempt-002 / `.2` | 34 | role / label / first / last / nth 的未变路径，含既定 iframe 失败路径；不沿用旧 fill 成功证据 |
| attempt-003 / `.3` | 8 | 未变定位路径及与 `.4` 字节相同的 fill；role 字面参数和 quoted nth 也在内 |
| attempt-004 / `.4` | 29 | 受影响 text 和四属性定位的原矩阵场景，实际执行 |
| attempt-006 / `.4` | 4 | text/title 的 `--name`、`--exact` 字面 fill 负载，实际补测 |

合计是原矩阵 75 个场景的证据，不是新增 75 条权威用例，也不是一次重跑完整 `.4` 矩阵。额外的嵌套、空串和引号正例保留在各自 attempt；6 个原语义不适用组合没有改判据。

## 完整输入与来源

三版各 80 个 CLI 文件全部留存于 `sources/2|3|4/cli/`，并逐字节等于共同上游归档加各自原始补丁的确定性重建结果。上游归档、三份补丁、SOURCE 元数据和 patched-input stamp 一并保存；没有用补丁段相同代替完整源码证明。

`file-comparisons.json` 表明只有 Cargo.toml、Cargo.lock、actions.rs、interaction.rs 存在变化。Cargo 两文件只变化根 package 版本，依赖、features、profile 的其他字节相同。完整 main.rs、commands.rs、connection.rs 以及其他模块和协议输入均相同。

原 `.2` 已测 helper 的 SHA 为 `b51f3f3b5a8cc819d3baa24602581fee177408b0ee2af9ba97fe4907c4ac1a54`。原构建日志和其归档 manifest、冻结 SOURCE/实测 binary、T052 原运行实际哈希均相互吻合。当前 `.2` build target 的 SHA 是另一值，明确没有用它冒充当时二进制，也没有推断差异的具体原因。`.3` 和 `.4` 当前 target 与实测冻结 helper 一致。此来源结论依据可追溯构建记录及实测输入，不声称可复现构建或机器级构建证明。

## 函数与分支边界

`function-comparisons.json` 保存原函数字节 SHA、源码行号和长度；`route-components.json` 与 `case-route-reuse-proof.json` 把每个原场景映射到实际 parser、native dispatcher、定位分支及动作函数。关键结果如下：

- `parse_find`、`execute_command`、`execute_subaction` 三版逐字节一致。
- 整个 role query/name/exact/cleanup 与整个 nth query/index/cleanup 函数三版一致。first/last 在同一未变 parser 中映射为 nth 的 0/-1。
- label 的前置、label 分支、错误/动作/cleanup 后缀逐字节一致。外围 `match_fn` 只构造纯字符串，label 分支不使用它；变化文本仅插入默认 text 分支。该区分和完整原文均保留，未把整个已改变的 semantic 函数误报相同。
- interaction 中只有 fill 从 `.2` 到 `.3` 改变；`.3` 与 `.4` 的 fill 完全相同。其他所用动作及其辅助函数未变。成功 fill 只使用 `.3`/`.4` 证据。
- `.4` 真正变化的是 semantic text/四种属性定位，并新增安全属性 query。函数外的残余执行 token 核对也只发现这几个已枚举变化；该辅助检查明确不冒称原字节相同。

四条 `.3` literal text/title 场景的 parser 和 fill 虽然相同，仍会经过 `.4` 已改定位分支，因此静态审查没有批准它们直接复用。`native-supplement-resolution.json` 记录 attempt-006 的实际补测原文、证据哈希及最终 75 项映射。

## iframe 与 Skill

三版 Skill 逐字节一致：已声明 nth focus 支持、find 不进入 iframe。原 iframe 夹具的外层只有 iframe，没有可供 label/aria 查询匹配的外层控件；未变 label query 只查询当前 document，返回失败后先于 execute_subaction/fill 退出。原始 native 错误、子 frame 值未变和零输入事件都已保存。因此这条复用的是明确的失败限制路径，没有把 `.2` 旧 fill 当作 `.4` 成功 fill。

这仍只是原受控 iframe 场景的证据，不扩大为任意跨源 iframe 或 Shadow 场景通过。T052 `.4` 的原生失效引用合同已由 attempt-004 独立通过；attempt-006 使用同 SHA 的宿主及 helper，没有重复执行它。

协调者复核本轮来源和逐场景映射后，可以据此合并 T065 I 层结果；权威账、完整用例要求及其他层级仍由协调者统一判断。
