# 原生历史恢复与持久身份联合验证

日期：2026-11-14。D01，关联 Q13／Q46–50。承接 §4.104，在同一候选身份／运行库上实际重启 Codex 并恢复历史，补正常续写、历史缺失和归档分支。attempt-P8gdYT 六项通过，未改产品源码。

## 基线和边界

SmartDD `5a9e04382441e24624cb94635f9d902c543a03d7`，383 项当前源码输入；程序化读取、运行和计划扩展沿用 §4.104 的最小补丁并在本目录重新构建。真实 Codex 0.167.1 固定二进制，六个独立原生进程均由现有内核 helper 校验 PID／出生身份。

实际创建一个线程，显式注入两条合成 developer 研究上下文；不是用户消息、业务批准或模型输入执行证明。没有 turn/start／模型请求。HOME／CODEX_HOME 和所有历史、数据库均位于本次隔离夹具目录；移开／恢复历史前先确认对应进程退出，没有操作用户日常会话。

程序化 prepared binding／source 与适配资源仍为夹具。当前 owner／run 生命周期及资源服务为实际源码加研究扩展；原生恢复观察账是诊断候选，不是正式产品 Schema 或新的执行授权。每次观察记录关联本 run、binding、generation、固定 source、runtime 摘要及预期／返回 native ID；接收后再次核对当前 owned run。协议明确拒绝与无可确认响应分别记录 rejected／unknown，本轮只实际触发 rejected 和 confirmed。

## 六项检查

| 检查 | 实际结论 |
| --- | --- |
| R01 初始历史 | 真实 thread/start 返回 ID，当前 owned run 写入共享 claim／来源；注入合成上下文 A 后退出，rollout 的 session_meta 与原 ID 一致，claim 保留 |
| R02 新进程恢复 | 新注册器／generation 2 的新进程恢复同一 ID；同 ID 回调幂等，binding、cap、revision 和 claim/source 不改变 |
| R03 合法续写 | 通过原生 inject_items 追加上下文 B，历史文件摘要改变且 A／B 均保留；第三个进程仍恢复同一 ID，不能要求历史字节永久等于首次 hash |
| R04 历史缺失 | 所有相关进程退出后移开隔离 CODEX_HOME，新进程对原 ID 返回 no rollout found；记录 rejected，停止本 run，不新建替代 thread，原身份／修订不变 |
| R05 显式恢复 | 恢复原历史目录后，以 generation 5 的新 run 恢复同一 ID；之前的失败记录仍保留，不把旧 run 标为恢复成功 |
| R06 归档分支 | 在隔离线程 archive 并退出，下一新进程 resume 得到归档错误；针对这一明确错误执行同 ID unarchive，再 resume 成功。观察顺序 rejected→confirmed，没有 thread/start 替代 |

R01–R06 均通过，无失败重跑。原空会话取得 ID 但不可恢复的反例复用 §4.47，本轮没有为重复计数重跑。历史摘要用于本次审计，不能证明模型理解、真人来源或固定权限。

## T3 参考与设计边界

只读核对 T3 `f313d0a6cb843551fb60e57a454a71e71a3a8c04` 的 CodexAdapterV2：ensureThread 与 resumeThread 分离；resumeNativeThread 只对 archived 执行 unarchive 后恢复，对 closing 等待记录的关闭事件后重试，其余请求错误继续失败。本轮只在隔离 native 客户端验证归档顺序，没有执行 T3 适配器，也没有验证 closing 并发窗口。

WillYou 保留这一“明确恢复与新建分离”的边界。Driver 根据固定版本解析可识别的恢复错误，宿主保持任务／绑定／来源；恢复原绑定且当前政策允许时，可针对归档执行原 ID 的取消归档／恢复。未知错误、缺历史或身份不符不能回退成新线程。closing 分支须依据真实关闭事件和运行代次处理，不能靠固定睡眠或通用重试；仍待联合。

## 清理和未验项

六进程均 exit 0，再次读取内核确认原身份 stopped；六 run stopped、九份租约 released，SQLite 完整性／外键通过。原协议账仅一个 thread/start、六个 thread/resume、两个 inject_items、一个 archive 和一个 unarchive；零 turn/start。

完整业务准入／私有桥、模型输入、实际用户来源、宿主崩溃及未知后代、合法迁移复制后的跨根恢复、原生降级与资源 GC 仍未联合。没有用一个版本和平台外推全部 CLI／SDK；Q 统计及正式产品用例不增加通过数。

复现：按固定依赖运行 patch.py、build.mjs、probe.mjs，需要归档声明的 Codex 二进制和 macOS 进程身份 helper，无需真实账号。见[结果](result.json)、[来源和审计](source-review.json)、[原始归档](raw-evidence.tar.gz)、[归档摘要](archive-manifest.json)。
