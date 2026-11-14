# 历史分页与实时合并验证

日期：2026-11-14。对应 Q44／A44，兼及 Q43／Q45 的缓存边界。产品源码与共享原型未修改，正式产品验收未执行。

## 实际运行与边界

- **T3 原模块**：esbuild 打包本地 `threadHistoryMerge.ts` 及其实际 visibility 依赖，无改写／stub；六项合成投影检查通过。实际执行 current row 优先、来源身份区分、隐藏 local item 保护、去重／保留 live tail、旧 cursor 不清新 loading、pending request 使用当前内容。清空保留的隐藏状态后旧页可再次显示记录是调用前提的负对照，不是完整 T3 客户端缺陷证明。
- **WillYou 候选协议**：Python＋真实隔离 SQLite／WAL、可控回复顺序；最终 `attempt-tmojxx_h` 十六项通过。前一批 `attempt-1vkyazgw` 十五项通过，后补“页面处在两次提交之间”后复跑；两批源码、数据库和结果均存档，没有失败批次被替换。
- 未运行 T3 完整服务／客户端、WillYou Electron IPC、新 TaskService／SDK、生产迁移、真实 DOM／滚动、长输出负载或真实业务。候选 Schema 仅做局部守卫，不替代正式 wire Schema／鉴权。固定任务及合成 database ID 用于确定性交错，不证明数据源恢复实现。

## 证据

| 检查 | 结论与范围 |
| --- | --- |
| T01–06 | [实际模块结果](t3-result.json)，输入与 bundle SHA 固定。真实源码的 hidden 语义不等于 WillYou 拟议 tombstone 字段 |
| H01 | 无条件 page upsert 覆盖较新内容、复活删除项；revision／tombstone 合并阻止，两者同时断言 |
| H02／H16 | 六种 page／通知交错（通知只触发连续补拉，不直接排序事件），另补 page 处于两次真实提交之间；最终已加载范围匹配数据库 |
| H03–04 | page 水位领先时不改缓存／游标，补齐连续事件后再合并；缺号批次原子拒绝，不能从 page 顺便跳过事件 |
| H05 | connection／view／history epoch 变化拒绝旧页和旧失败回调；database identity 不匹配拒绝。未执行真实切窗口／重连 |
| H06 | 删除标记直接驱逐会复活旧页内容的负对照；轮换 history epoch、废弃旧请求、重取当前窗口后再加载能规避 |
| H07–08 | immutable keyset 在前页边界项被删除及新尾项插入后不漏／重；两个实际 SQLite 连接证明 page rows 与水位处于同一 WAL 读事务 |
| H09–12／15 | 无效末行、同 ID 冲突重复、同 revision 不同内容、无进展／错作用域 cursor 不部分更新；相同重复行及重复回复不产生重复，全部删除后的空页可结束 |
| H13–14 | 有界窗口之外的缺省不当删除，独立草稿与 anchor 元数据不被合并函数覆盖；删除 ID 不复用、同名不同 source 隔离。不是像素位置或新消息定位测试 |

[候选结果](result.json)、[源码](probe.py)、[原始批次](attempts.tar.gz)、[来源哈希](sources.json)。所有数据为合成，数据库 integrity_check 已在退出时核对；没有真实历史／凭据。重放指令：解压批次可读原始结果；在隔离目录用 Python 3 运行 probe.py（会新增 attempt 目录），T3 构建脚本依赖记录中的本地 checkout 和已有隔离 esbuild；已打包的 t3-merge.mjs 留作实际执行工件。

## 参考与设计决定

T3 `threads.ts` 的 loadEarlier 在 applyLock 下复核当前 cursor 并合并，失败／中断清理也只作用于当前 cursor；`threadHistoryMerge.ts` 按 sourceThreadId＋sourceItemId 去重，保留当前内容和隐藏状态；服务端采用有预算的 keyset 页。这里只读其 controller／server 路径，未执行完整锁／HTTP／断线恢复。WillYou 当前 TaskController 仍是 list/get/open 等 PTY 任务命令，TaskView 没有统一消息投影；不能把此次候选实验记为已有 IPC 功能。

WillYou 在 §4.2 补充 pageReadSeq、history epoch、稳定顺序及墓碑保留规则；这是适配其任务内连续事件合同的方案，不声称 T3 采用相同字段。历史页不能推进 eventSeq、覆盖运行／审批状态或把缺省项当删除；pageReadSeq 领先时先补事件，裁剪则重取快照并作废旧页。加载失败／取消也要核对请求身份。缓存预算耗尽时允许收起已展开历史并重新加载，但保留独立草稿与可恢复锚点，真实锚点位置另验。

边界：没有证明 history epoch 在真实缓存层的发布原子性、后台回调生命周期、实际数据库迁移、IPC 缓冲／超时／存活、滚动虚拟化和内存预算。协议的输入上限／完整 Schema、长历史性能与 Q45 仍需验证；Q44 保持部分，A44 未执行。
