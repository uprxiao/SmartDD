# CLI 诊断回传与请求归属验证

2026-11-14；技术方案 §9.7.1、验证账 §4.72；R01／08／10，Q01／37 的诊断边界。仅隔离研究，产品源码／正式 Schema 未修改。

## 真实链路与结论

当前程序化注册器预留／准备／arm，再登记实验自己启动的通用 Node 根进程的真实 PID／出生身份。该根实际启动当前及候选编译 CLI，经 Unix socket、MacUnixPeerIdentityReader 和真实祖先检查进入网关。这里没有 Codex／Claude 或模型回合，也不声称验证完整 Provider 启动器。Electron 分配被禁止，浏览器只有元数据能力。

最终 attempt-om5rPS 五项通过，5 份真实内核 peer 证明：

| 检查 | 证据 |
| --- | --- |
| D01 现状 | 原 Schema 拒绝审计写入，网关返回 auditUnavailable，但原 CLI 丢弃字段；权限仍正确拒绝 |
| D02 回传 | 候选 Schema＋CLI 将 auditId 传出并对应 SQLite 行；注入 INSERT 失败后传 auditUnavailable=true，仍返回 AUTH_REQUIRED／退出2 |
| D03 归属反例 | 同一真实连接先成功 list，再用无效 token call；当前 peer.authenticatedRun 残留使拒绝审计错误关联旧 run |
| D04 每请求身份 | 候选 receive 局部保存本次认证结果。无效 token 只写 run_id=null；本次认证完成后的注入处理器失败保留真实 run，SQLite 可关联正确 task／project |
| D05 并发 | 一个已认证请求等待，另一个无效 token 被拒并退出；后续第一个请求失败仍保留自己的 run，第二个不借用它。候选不能仅在 receive 开头清空共享 peer 字段 |

D05 使用临时 FIFO 等待真实认证完成；不绕过身份验证，不用 sleep。首个并发尝试因 CLI 提前退出而出现 PEER_UNVERIFIABLE，属于实际安全拒绝，但没有覆盖预定交错；修正驱动同步后通过，原始失败保留。首批4项、扩展失败批、最终5项三个通用根均退出0，全部运行资源收束。

最终 SQLite 保留六条拒绝，其中一条故意保留 D03 的错误归属反例，不能把整张表误记为修正后的数据。认证后处理器错误为显式注入，底层工具业务正常结果不是本批重点。

## CLI 返回兼容合同

候选为现有拒绝结果增加可选 auditId／auditUnavailable，保留 error、requestId、operationId 和既有退出码。auditId 需合法 UUID，auditUnavailable 需真正 boolean，两者不能同时表示“已有审计编号且审计不可用”。旧宿主无这些字段仍能解析，但缺字段不证明审计成功。

另以受控本机 socket 响应驱动同一编译 CLI，9 项检查通过：旧响应、合法编号、true／false boolean、unknown effect 仍退出5、坏编号、数值／字符串假 boolean、互相冲突字段。后四类返回 INVALID_RESPONSE／退出4。这组只证明序列化与解析，不冒充真实网关授权或 UI。

宿主 UI 仍从可信记录读取诊断：本次认证成功才按 run→task/project 关联；无 run 的拒绝进入宿主级诊断，不按请求里的 task、token 或上一请求猜测。auditId 是查询关联值，不是授权令牌；查询服务须重新检查当前用户／项目访问范围。新诊断服务、IPC／订阅及 UI 尚未实现，不能以 SQL join 通过代替。Schema 扩充与请求局部归属应一起实施，避免原本被 Schema 拦下的错误归属随迁移开始落库。

## 复跑与限制

先恢复[前批依赖与资源](../20261114_原生浏览器CLI与拒绝审计验证/README.md)，按 source-review 的归档哈希核对。build.mjs 在 SmartDD cwd 构建临时 bundle；build-cli.mjs 仅编译临时二进制；node probe.mjs 运行真实网关链，node wire-contract.mjs 检查受控响应。需要本机固定 Node ABI／依赖、macOS arm64 编译与内核身份 helper；资源目录与依赖不重复归档。

baseline.cjs 保留前批未改 CLI 网关；candidate.cjs 包含仅在内存构建的请求局部身份变体。原始拒绝 Schema 候选来自前批，未分配正式迁移编号。没有日常凭据、外部网络、模型花费、产品改动或 UI 验收。

[结果](result.json) · [运行核验](runtime-audit.json) · [源码依据](source-review.json) · [摘要](archive-manifest.json) · [原始证据](raw-evidence.tar.gz)。127 文件、3 份 SQLite 完整性／外键通过、708 构建输入核对。
