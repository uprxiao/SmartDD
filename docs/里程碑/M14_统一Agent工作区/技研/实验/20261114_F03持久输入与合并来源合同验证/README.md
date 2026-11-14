# F03 持久输入、Claude 合并回声与来源恢复

2026-11-14。F03 的研究合同关闭；没有实施产品接线，也没有提升产品验收。现行设计见[技术方案 §6.2.1](../../技术方案.md#621-共同输入合同与实时来源的接合f03)，当前计数见[验证账 §7.6](../../全局设计验证账.md#76-逐项研究关闭审计与冻结清单2026-11-14)。

## 结果与证据边界

| 检查 | 结果与范围 |
| --- | --- |
| Claude 真实排队／合并 | SDK 0.3.321／native 2.1.321、macOS arm64；首个模型响应暂不返回时，后续三个输入均发出 queued；随后一个回合同时回显三个 UUID，单 UUID 是最后成员。两个模型请求全部来自本机合成端点，无真实 API 消费 |
| F03-01–04 | 四组合同检查通过：完整 UUID 集合、私有通道／畸形与子线程拒绝、queued／started／echo 分层、同文不同来源与恢复不复活 RAM receipt |
| F03-05 五个窗口 | 独立 SQLite worker 分别在 journal 前、第一成员插入后、journal 提交后、第一成员应用后、应用提交后 SIGKILL。确认实际 PID／出生身份已停止后重开恢复，无半组合提交；无持久回执为 unknown，有完整回执为 accepted-audit-only |
| F03-10 来源枚举 | 对齐 C1.2 的 child-result；四种内部来源均不取得真人来源，ui-user 只能走模拟受信用户入口。原研究 helper 的 tool-result 别名不静默当作新来源 |

最终是 10 项隔离合同检查（9＋1），真实排队／合并是它们的协议输入证据，不再加成一个 Q 或产品通过数。[原生结果](native-result.json)、[原生帧摘录](native-evidence.json)、[九项结果](contract-result.json)、[来源枚举补验](source-branches-result.json)分别保留。

## 原生实验

native-wriTWg：一个真实原生进程，两个本机模型请求，工具集合为空；输入由宿主异步队列提供，模型响应时点由事件门闩控制。三条后续输入包含同文的 ui-user／history-transfer 与另一条 ui-user。source 是宿主研究标记，不谎称 native 自身携带它。终态 success 后主动关闭 Query，退出码 143 是受控关闭，HOME／合成工程删除；未访问日常配置或项目文件。原生 result 的 costUSD 是执行器按模型名称估算，不能写成真实付费。

初次 native-VrwpSn 被沙箱的本机 listen EPERM 拒绝，零进程、零模型请求；经自动审批允许隔离监听后执行上述成功批次。失败记录留在归档，不算 SDK 功能失败。

## 持久化与权限边界

数据库是 F01 C1.2 的独立副本，保持原表、不可变来源触发器及外键，不修改 schema 或产品源码。每个逻辑 submission／turn 继续独立；同一原生帧通过按 run／generation／frame UUID／input ID 生成的 inbox 键原子扇出。申请只应用最后一个成员被拒绝；同帧不同内容、缺成员、错 session、子线程、未声明生命周期、缺回声均不补造接受。

用于关联的 run 是既有已停止的关系夹具；live 来源测试的 sender／current run／原生文件证据参数也是显式夹具。真正 owner、私有业务桥、文件 proof 和实际邮件服务的证据复用 §4.107–108，本批没有再执行邮件／业务，也不把关系夹具当作真实活动 owner。源码 bundle 的 681 项来源重新逐个核验一致；[复用模块核对](reused-source-review.json)对照相应已执行快照，未重跑旧原生实验。

五个 SIGKILL worker 仅消费本批真实录制帧，不在该 worker 内再次启动 Claude；它们证明当前 C1.2 上多成员 journal／应用的 SQLite 崩溃原子性。完整 native＋宿主退出的既有 Codex 五窗口证据仍来自 §4.56，不将两批描述成一次新端到端实跑。恢复只读／应用审计，测试中没有创建新来源 receipt；旧 owner 活或未知拒绝接管。SQLite 完整性与外键均通过。

新候选来源 helper 只将内部枚举 tool-result 改为 C1.2 的 child-result，[差异说明](source-gate-change.json)记录精确摘要；其余 live 来源算法保持原样。F03-04 使用旧 helper 验证 user／history 的共用路径，F03-10 单独验证变动的枚举分支，未为一个枚举变化重跑五个退出窗口。旧历史标签的导入映射归 F13，不修改既有记录。

## 复用旧证据与退出标准

§4.56 已证 Codex 的未发送／发送未知／原生接受／journal／receipt 五窗口；§4.62–63 已证两端通知 sending 不被 read／ack 擦除；§4.107–108 已证两端原生文件与实际业务来源。此次仅补 C1.2 多输入与 RAM 来源的交界。设计明确同任务切换、历史注入、委派输入和回父通知共用此合同，故 F03 可停止；F04 配置来源、F08 业务未知准入仍各自待处理。

未声明验证 synthetic 中途 fold 的所有原生行为、所有 resume_reason、子 Agent 或所有未来版本；它们的审计／拒绝出口已明确，不以未知回声自动授权。批次终态如何显示、逻辑 turn 同组结果如何呈现归现有 F16 UI 合同；本批没有修改 UI、正式 IPC 或生产回执入口。

## 归档与重放

[证据包](evidence.tar.gz)、[文件清单](archive-manifest.json)、[摘要](archive-summary.json)保存脚本、成功及前置失败、合成数据库、实际 bundle／来源清单和所复用的研究模块。无凭据、原生二进制、用户数据库。

原执行：native.mjs 需要固定 SDK／native 和本机监听权限；probe.mjs 依赖固定 better-sqlite3、实际 bundle、内核身份 helper 与 NODE_PATH；source-branches.mjs 无外部调用。绝对路径记录原环境，搬迁后须显式配置依赖及核对来源摘要。归档校验只核摘要／结果，不重复运行原生或故障实验。研究脚本中的进程／当前运行夹具不是生产实现。
