# SVN 持久委派与真实运行联合验证

日期：2026-11-14。对应 M14-R02／R04–06／R09–10，补 Q04／Q16／Q24／Q27／Q30／Q32。**仅隔离研究，未修改产品、共享原型或依赖配置。** 临时 SVN、本地模拟模型、独立 HOME／配置根、合成凭据；没有真实模型账单或业务操作。

## 同一批链路

真实父 Agent → 现有私有 MCP bridge／内核 peer 证明 → 实际 ApplicationToolService → 候选 SQLite 委派账 → 立即返回 `waiting_parent_release` → 父原生回合结束、进程／桥退出、实际 owner stopped／资源释放 → 同一 SVN WC 中的真实子 Agent → 私有写工具在临时目录创建 result.txt → 持久结果 → 新进程恢复原父 native 会话并收到结果。

实际执行 CapabilitySessionRegistry／CapabilityRunRegistry／ResourceStore、MacProcessIdentityReader／MacUnixPeerIdentityReader、PrivateApplicationBroker、AgentBridgeProcesses、ApplicationToolService 和原 bridge-runtime。32 份现有迁移由 runFixture 原样执行；两端快照 native.cwd、实际进程 cwd 和目录租约均指向同一个真实 SVN WC，补上早期 W07 只改实际执行 cwd 的局限。父、子是不同 task；父恢复沿用原 task／native ID、新 run／PID，不用另建父会话冒充续聊。

模型端为合成 Anthropic／Responses SSE。测试 fixture 只替换 cwd；Codex 另替换 runner／配置根。Vite raw glob 仅为 Node 构建替换；产品源未改。[build.json](build.json)记录 455 个构建源及输出哈希，源码审计时逐一匹配。

明确的候选／夹具：SQLite 委派与目录协调器、目标选择／政策、预创建的父子 capability store 和合成写 handler。为复用现有私有桥合同，用测试包的 `smartdd_zentao_write_v1` 承载委派／写入，实际 ToolService 检查 write 语义；这不是正式 delegate API，也没有调用禅道。运行记录仍使用旧 ptyId 合同，未迁移为正式 binding／generation Schema。

## 八项结果

| 父→子 | 场景 | 结果 |
| --- | --- | --- |
| Claude→Codex、Codex→Claude | 正常异步交棒，各一项 | 父持有租约时提前启动子被拒绝；父排空后才取得子写入权；结果只产生一次；恢复父 native ID 与原会话一致，模型请求包含旧 WAITING_CHILD 和一次内部结果 |
| 同上 | 持久接受、父已排空、子尚未派发时 SIGKILL 宿主，各一项 | 重开同一委派库和能力库，从 queued 继续；未重新创建委派／重跑父接受回合；最终结果投递一次 |
| 同上 | 子结果已持久化、子已排空、父尚未接收时 SIGKILL 宿主，各一项 | 原结果保留；不重新执行子写入；恢复原父会话完成接续 |
| 同上 | 内部结果已出现在父的实际模型请求、尚未返回终态时 SIGKILL 宿主，各一项 | 预先为已捕获 root／bridge PID 登记 kqueue NOTE_EXIT；观察实际退出后重开原能力库，真实 owner recovery 收口旧 run；委派变为 delivery_unknown，协调租约保留，投递确认数仍 0，无第四次 native 启动／重发 |

[汇总结果](result.json)为 8／8：正常／已排空恢复批 attempt-oNvS2b 六项，新增活跃投递中断批 attempt-23N78k 两项。两批源码各自归档，不能把后一版驱动未重跑的路径另计通过。共 24 次 native 启动、40 次本地模拟模型请求；其中 22 个回合完成、2 个恢复回合被故障中断。24 个实际 run 最终 stopped，登记的 native／bridge 内核身份均 stopped，实际 run 资源租约未释放数为 0。两个 unknown 案例的候选目录占用有意保留，不伪装成任务成功。

每例保留委派数据库、父子能力数据库备份、原生协议／模型请求／历史副本、目录身份、工作区结果、进程及 checkpoint 记录。SQLite integrity／foreign_key 检查通过，见 [原始归档](raw-evidence.tar.gz)及[文件哈希](evidence-manifest.json)。首轮 attempt-0WME4D 的三个原生阶段已完成，但控制器在成功断言中读取不存在的空 stderr 文件而报 ENOENT；修正观察代码后重跑，旧批完整保留，不计为正式检查通过。

## 对设计的约束

- 接受、父回合结束、owner 排空、子完成、结果保存、投递确认分别持久化。普通模型输出或进程根退出不能代替目录交棒证明。未知投递不能因为宿主已重启、实际 owner 已停止而重发。
- 目录释放须核对原生／桥内核身份、实际 run 与在途 activity／资源状态；恢复读取原记录，不能只凭数据库里“进程退出”的缓存。本轮仅覆盖受控 root／bridge 范围；早期 G04／W08 的逃逸后台写者风险仍未关闭。
- 直接注入结果只是本轮交棒实验的传输。终态与排空是此驱动选择的确认门槛，不定义所有适配器必须等整回合结束才确认收到消息。正式协议仍须区分传输接受、原生输入确认、Agent 结果观察、回合完成与业务执行。
- 本轮内部输入不签发真人业务权限。虽然 Claude 使用 synthetic 标记，Codex 使用 client ID，来源账／实际业务上下文未接入此链；不能用这些标记或本批通过推断邮件／浏览器／插件授权已正确。

## 与 T3 的对应和未决项

本地 T3 基线 `f313d0a6cb843551fb60e57a454a71e71a3a8c04` 的 `ProviderContinuationService.ts` 核对 parent run／generation／message ID，使用 `queue_after_active`、`createdBy: agent`、`creationSource: server` 发送完成通知，文本引导 `task_status` 读取实际结果；EffectWorker 的 steer 接受路径再提交 `notification.delivery.accept`。本批只读核对这些源文件，哈希见原始归档的 t3-reference.json；没有运行 T3 的该套测试。

WillYou 应复用“宿主控制路由、持久投递身份与显式观察”的机制；不照搬 T3 的 Git checkpoint 或直接把其重试逻辑当成现有业务写操作可重发的依据。本轮没有验证通知→status 结果读取、主动读取与自动通知竞争、父忙多个结果、父 Provider 切换后的投递、子提问／审批／递归取消、Skill 加载→委派或完整数据迁移。父子能力库是隔离的预创建夹具，跨库候选协调不证明正式子创建／receipt／outbox 的单事务原子性；合成文件写与 SQLite 之间的中断窗口也未覆盖，不承诺外部恰好一次。

本机组合为 Claude Agent SDK 0.3.321／原生 2.1.321、Codex 0.167.1、macOS arm64。没有 10GB+ 实项目性能、其他版本／平台、真实模型自主规划或供应商兼容证据。Q 项保持“部分”，产品验收仍 **54 条、0 通过、54 未执行、0%**。
