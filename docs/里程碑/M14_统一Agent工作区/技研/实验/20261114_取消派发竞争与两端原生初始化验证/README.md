# 取消派发竞争与两端原生初始化验证

日期：2026-11-14。补 R02／R08／R10，Q04／Q05／Q13／Q48。[结果](result.json) attempt-xDDuq4 十三项限定检查完成；[原件](raw-evidence.tar.gz)、[文件清单](evidence-manifest.json)、[审计](audit.json)、[运行程序与退出核验](runtime-audit.json)、[构建](build.json)和[源码及夹具说明](source-review.json)可复核。**仅技术研究，没有产品／共享原型实现或产品验收。**

## 本批要解决的分支

前批宿主死亡恢复可等待真实 run recovery，再回收准备。正常宿主中的取消不能等宿主退出，也不能因当前业务授权已经撤销而无法清理自己的资源。另一方面，armed 且无 PID 并不自动证明没有尝试启动。必须由拥有本次启动入口的宿主代码，在关闭后续派发后给出限定证明。

本批在前批持久交付 receipt 上加独立取消协调器：create 时核实际 owned run，保存宿主内 WeakMap 句柄；外部复制对象或只给 receipt ID 不获得取消权。取消同步关闭单次启动入口，随后排空已经开始的准备操作，再按宿主私有的 attempted 状态选择已有 cancelBeforeFork 或实际 stop／exit 路径。该 attempted 状态只由唯一 OS spawn 调用边界设置，不接受模型／UI 填写。

源业务代码未改。实际 reserve、arm、attach、cancelBeforeFork、stop、exit、资源锁、GC 和 Mac 进程身份仍复用 SmartDD。programmatic binding／receipt 是候选，run 仍从 legacy reserve 创建后由夹具关联。Codex 夹具只替换 runner 和隔离原生状态目录，两端共享同一真实运行注册器及句柄证明，不是将 Codex 误登记为 Claude。

## 派发与取消的候选顺序

先提交交付接管、结束准备占用、登记 arm，再检查当前配置及政策。唯一 spawn 回调同步核关闭状态／当前配置／实际 run，标记 attempted 后创建进程。候选 shell 在专用 pipe 上等待，真实进程身份 attach 完成且门未关闭才 exec Agent。这个 shell 是实验封装，不是现有产品的既成实现；尚未解决所有平台与多线程／多宿主启动接口。

取消先关入口：没有尝试 spawn 时，可信闭包可调用既有 cancelBeforeFork，即使已经 armed 或业务政策撤销；随后核实际终态、撤销、所有进程／活动／租约，再结束本次准备引用。已经创建 wrapper 时，即使 Agent 正文尚未 exec，也不能声称未启动；等待同一个 ChildProcess 的 exit 和实际 run 收口。迟到回调始终被已关闭入口拒绝。

业务授权与清理权分开：清理依据是原先签发并绑定 store／run／owner 实例的句柄、原启动闭包及现时终态，不重新申请已撤销的业务许可，也不给新工具调用或新启动放权。Provider close 的异常不直接代替退出证明；宿主仍需核原进程与租约。

## 十三项检查

| 项目 | 已验证的边界 |
| --- | --- |
| C01 | 创建后撤销运行政策并删除配置，原宿主仍可取消确定未派发的准备；复制取消句柄被拒绝，迟到 start 不启动进程；实际删除旧交付包，源历史保留 |
| C02 | after-adopt 检查点取消先关入口，准备尚未排空时 GC 继续保留；解除检查点后取消收口，没有进程创建 |
| C03 | 已 arm 但控制权仍在当前宿主、尚未尝试 OS spawn 时取消，可信闭包证明可用；零进程创建。不能把这项套到宿主崩溃后的 armed 记录 |
| C04 | arm 后撤销当前政策，后续 spawn 前复核拒绝；无需恢复业务许可即可清理 |
| C05 | Provider 已取得 spawn 回调但延迟调用，取消后该回调被拒绝，零进程创建 |
| C06 | wrapper 已创建、attach 尚未放行时取消，实际 exit 后收口；没有调用未 fork 取消，payload 未执行 |
| C07 | 受控 Node payload 实际启动并 attach，撤销政策后仍能停止自己的进程；实际内核身份确认停止 |
| C08 | 重复 start 被拒绝，不分配第二进程；重复 cancel 复用同一收口 Promise |
| C09 | Provider 工厂在调用 spawn 前抛错，关闭入口后通过原闭包取消；不把此项推广为所有 spawn 异常可直接释放 |
| N01 | 真实 Claude SDK 调用自定义 spawn；wrapper 等待 attach 时取消，SDK 和宿主收口，Claude native 未 exec |
| N02 | 真实 Claude SDK／native 完成 initializationResult，随后撤销政策并改变配置修订，仍能停止并释放本次运行占用 |
| N03 | Codex app-server 的 wrapper 等待 attach 时取消，真实 app-server 未 exec；按实际 wrapper exit 收口 |
| N04 | 真实 Codex app-server 返回 initialize 响应，撤销政策并改变配置修订后停止并释放 |

共创建六个本次拥有的子进程：两个受控 Node 场景、四个 Provider 场景；其中只有 N02／N04 真正 exec 并初始化 Agent，N01／N03 只启动 wrapper。Claude SDK 0.3.321／native 2.1.321、Codex native 0.167.1 的二进制哈希与此前核验版本一致，精确值见 runtime-audit。没有发送用户 prompt、thread/start／turn/start 或业务调用；配置为私有 HOME／状态目录、合成密钥与不可达 loopback 端点，不用真实供应商账户。

每项最后核旧交付资源可清理或已实际删除、源历史仍保留；数据库在 finally 结束本次运行后备份，结合 trace 看中途状态。六个子进程均有原 ChildProcess exit 记录，读取的 PID 只来自本次捕获的对象，没有按名称枚举／杀进程。

## 失败保留与尚未覆盖

attempt-micRYa 的 C01 已完成物理删除，公共尾检查又要求 removed 资源可再次清理而失败。该驱动检查修为“已 removed 核物理路径不存在，否则核 canCollect”，保留所有源历史及运行退出检查。候选取消逻辑没有改变；attempt-xDDuq4 再执行完整矩阵，十三项完成，旧失败原件保留。

本批没有真实模型回合、MCP 业务桥、业务在途或后代后台写者。§4.18 等既有桥／原生回合证据仍须与本批完整新版计划联合，不能直接相加当全链路通过。OS spawn 同步抛错、无 PID 的 error、取消收口失败后的再次恢复、跨宿主竞争、其他平台及最终 launcher 接线仍待验证；attempted 已为真却没有可信 exit 时，候选不会自动改成未派发释放。当前配置读取为真实 registry 政策回调加 SQL 配置夹具，不代表完整配置服务／凭据变更路径完成。
