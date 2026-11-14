# 长输出缓冲与存储故障验证

日期：2026-11-14。对应 Q45／A45，兼及 Q44、Q48。只改设计与实验文件，没有更改产品、共享原型、项目依赖或日常数据，没有运行真实 Agent／付费模型。

## 三组证据及其边界

1. **实际 T3 缓冲模块**：未修改 `LiveStreamBudget.ts`，在隔离目录使用锁定的 effect 4.1.3，七项检查通过。UTF-8 字节边界、release 幂等、已出队但未 ACK 的计费、条数／字节两种溢出后的重放、累计超过预算的快速消费、完整状态合并与增量误用反例、同 key 的 in-flight＋pending 同时计费均有断言。没有运行 T3 RPC／服务／真实数据库或客户端，重放数据为内存合成数组。[结果](t3-result.json)。
2. **实际 SmartDD 控制响应处理器**：打包原 `CodexPrivateServer.listen/rejectRequests`，绕过构造器，以 EventEmitter 代替 WebSocket、stop 为记录夹具。两个检查通过：1355 个各 6191 字节的通知累计到 8388805 字节时触发 INVALID_RESPONSE／stop；交互请求返回 -32601，不代办审批。没有启动私有进程／Unix endpoint／native 或验证 owner。它证明当前控制连接不能直接变为持续模型消息连接，不是现有用途的缺陷。[结果](private-result.json)。
3. **WillYou 候选 byte framer＋artifact sink**：十二项检查通过。真实 Node 子进程、管道、文件与 SQLite；输入全部合成，不是 SDK 数据、IPC 或生产存储实现。[结果](stream-result.json)。

## 候选实验细节

| 检查 | 实际证据 |
| --- | --- |
| O01–02 | 中文／emoji／CRLF 的全部 38 个二段拆分点均完整解析；一个 80000 字节 chunk 内的 10000 个小帧不按 chunk 总量误拒，单帧 budget 32 字节 |
| O03–05 | 超大 UTF-8 帧、无 newline 的半帧 EOF、非法 UTF-8／JSON 明确失败；失败后不接纳下一帧；恰好等于单帧预算可接收 |
| O06 | 真实子进程退出 0；1536 帧共 11010048 字节正文写入文件，内容哈希匹配；framer 最大待解析帧 7193 字节，每条 SQLite preview 最多 128 字节。不是全进程 RSS／峰值堆／吞吐或 IPC 的测量 |
| O07 三分支 | 注入 ENOSPC、实际文件 fsync 后抛错、SQLite 事务提交前抛错：不新增已提交事件；失败实例拒绝继续 append。关连接重开后按已提交前缀对账，移除合成孤立尾部，再继续写入 |
| O08 | artifact quota 不允许悄悄截断正文并发布成功事件 |
| O09 | 在实验 SQLite 设置 max_page_count，真实获得 database or disk is full；已提交 34 行保留，未提交文件尾部对账后长度与引用一致。没有填满本机磁盘 |
| O10 | 删除已提交内容后，恢复拒绝，已有引用不伪造成完整输出 |

候选使用固定、独占且完全受控的实验文件，artifact append 和 SQLite 事务不原子；没有实际进程崩溃／断电，O07 是同步故障注入后的连接重开。真实实现必须另核对目录／inode 所有权、引用／读租约、并发写者、数据库迁移、目录 fsync、未知 commit 及 GC；不能直接把实验的 truncate 操作搬到任意原生文件。候选同步文件写入仅为确定性实验，不是主进程性能方案。

## 失败与复验

前两次 bundle 构建缺 ws 依赖，源码未执行；隔离安装 SmartDD 锁定的 ws 8.22.1 后成功。T3 驱动首轮五项完成，在 B05 错把懒加载流当已启动，等待尚未发生的 source closure；Node 因未决顶层 await 退出 13。调整驱动为先 pull 再等待，最终七项通过；T3 代码未改。[前置记录](preflight.json)及[原始工件](raw-evidence.tar.gz)保留该批源码／五项结果、最终候选数据库／文件和实际运行 bundle。

构建来源及 SHA 见 [build.json](build.json)、[sources.json](sources.json)；依赖锁见 [package-lock.json](package-lock.json)。归档不含 node_modules。重新运行实际模块检查需要按锁在独立目录安装依赖、恢复记录中的源码路径或取归档 bundle；实验驱动只使用合成数据。

## 设计结论

- native 帧、尚未处理／确认的数据、预览、完整产物和存储配额是不同预算；不能拿旧控制连接总量限制当模型流单帧上限，也不能把一批 OS chunk 当一个 JSON 帧。
- T3 的预算计入 in-flight，释放发生在下一次 pull ACK 或作用域结束；慢订阅溢出终止后可从已接收 sequence 重放。WillYou 的通知＋补拉仍以已提交 taskSeq 为权威，不因为 UI 太慢杀整个 Agent。
- 最新完整状态可以合并；文本增量直接按 key 留最后一条会丢字，负对照输出仅剩 c。只能按连续 revision／范围拼接，或从已持久完整状态生成替换帧。审批／完成／错误不得因文本队列繁忙被丢弃。
- 文件已写入不代表事件已提交；完整输出读接口只暴露已确认范围。失败后标记不完整／恢复待核对，不能把写满、丢尾或 unknown 显示成成功，也不自动重新执行产生输出的命令。

T3 CommandOutputHub 的 tail／replace、按键缓存上限和单 token 唤醒本轮仅作源码核对；没有把其字符上限、时间节流或终端转义处理当 WillYou 的既定参数。Q45 提升为局部证据，仍非通过；实际 Agent 事件帧规模、消息累计快照归一、生产 artifact 读／租约／回收、IPC 缓冲、RSS／多任务负载和打包 UI 待验，正式产品验收仍 0／54。
