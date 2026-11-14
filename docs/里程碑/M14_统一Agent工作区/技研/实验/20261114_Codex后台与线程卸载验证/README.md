# Codex 后台命令、线程卸载与启动参数验证

日期：2026-11-14。macOS arm64、Node 26.5.0、受管 Codex 0.167.1（native SHA 见 runtime-inputs.json）。调用真实 app-server、exec_command、command/exec 和原生后台终端 API；模型为本机 Responses 模拟端点，没有真实供应商请求或业务写入。正式源码未改。

## 方法

独立 HOME／CODEX_HOME／项目目录；模拟模型仅返回固定的 Node 临时 writer 命令。writer 连接回环控制端口，收到明确指令才写本实验日志，便于证明某个生命周期节点之后它是否仍可执行。内核身份由现有 macOS helper 只读读取，记录实际 PID／出生身份及 stopped 状态。工具 JSON／输入协议、事件、写入日志及清场证据均归档。

本探针为观察普通执行命令使用 danger-full-access，执行内容是探针固定文本；不作为权限／sandbox 回归证据。没有执行模型提供的任意外部脚本。没有运行完整 T3 adapter 或 WillYou owner／能力桥；T3 只作为停止接口与启动参数的只读参考。

## 批次及关键更正

| 批次 | 参数与实际结果 |
| --- | --- |
| attempt-1 | native 默认卸载参数。C01 通过；C02 已收到 unsubscribed，但 20 秒内没有 thread/closed，探针按原严格期待失败并清理。后续 C03–C06 未执行。 |
| attempt-2 | 将 C02 改为分离观察 ACK、loaded 列表与真实写者：取消订阅后线程仍 loaded，写者仍能写，兄弟正常。其余 C01／03／04／05 的限定检查通过。该“通过”不是卸载成功。 |
| attempt-3 | 延续默认参数的负对照，新增 C06 原生后台终端定向停止，六项观测完成。C02 仍未证明立即卸载。 |
| attempt-4 | 加入 T3 实际使用的 `thread_unload_delay_secs=0`，恢复 C02 严格关闭断言；六项检查通过，目标线程关闭与写者停止，兄弟仍运行。 |

此前超时由探针未带 T3 的关键参数解释，不能写成“Codex 0.167.1 不支持线程卸载”或“T3 卸载失效”。原始失败、诊断批次及最终参数对齐的复验分别保留。原生默认延迟的具体秒数未测，不以 20 秒观察窗口推定其配置值。

## 场景与证据

| 编号 | 实际验证 |
| --- | --- |
| C01 | 原生 exec_command 返回执行 session 后 turn completed，后台 writer 仍可写；回合完成不等于命令退出 |
| C02 | 默认参数取消订阅不立即清理；带 T3 参数时收到 thread/closed、loaded 列表移除、写者 stopped；同 app-server 的兄弟 writer 仍可写 |
| C03 | 对在途前台命令发 turn/interrupt，收到 interrupted，写者 stopped，兄弟不受影响；未证明一个 interrupt 清掉所有既有后台工作 |
| C04 | 宿主直接 command/exec 使用自定义连接内 processId；错误 ID 被拒、正确 terminate 返回后原命令结束，兄弟不受影响 |
| C05 | app-server stdin EOF 正常退出，剩余普通后台写者 stopped；不是强杀／异常崩溃测试 |
| C06 | 模型工具后台终端 list 的 processId 与 command item 对应；错误 thread 返回 terminated:false；拿此 ID 调 command/exec/terminate 被拒；正确线程定向终止后列表清空、写者停止，兄弟仍可写 |

C06 列表 osPid 为 null，原生 processId 是执行 session 标识，不是可直接杀的 OS PID。后台 list 的分页接口已检查 Schema；本实验仅一项，没有覆盖多页。

## 复现及文件

在可写临时目录放置 writer.mjs 与目标批次的 probe.mjs，按脚本顶部修改本机 native／helper 路径，然后运行：

```sh
node probe.mjs new-default-run
node probe.mjs new-t3-run --t3-unload
```

归档根 probe 是最终版，可重放默认参数与 T3 参数差异；精确重放各次历史结果须使用对应 attempt 的脚本。不能在旧输出目录重复跑后声称仍是原证据。每次独立启动自有进程和回环服务器并清理，不使用用户真实配置。运行依赖真实 macOS 原生 helper；其他平台不能直接视为已验证。

每个 attempt 保存脚本、result、cleanup、runtime-inputs、process 日志、工具 Schema 和 .writes。wire／model／stderr 压缩归档，`raw-files.json` 为解压内容哈希，manifest 校验归档本身。完整 native／HOME 不归档；source-evidence.json 包含 T3 adapter／启动参数、SmartDD owner 边界及 native 生成 Schema 的哈希。运行时原生警告 PATH alias 未创建，但本次实际 exec 工具成功；未验证 apply_patch 等其他工具。

## 对设计的影响及未完成项

- 版本兼容还需包括关键启动参数。卸载等待关闭证据，不把 unsubscribe ACK 当资源已释放；没有通知或状态不明时保留 closing／recovery-required。
- `thread/backgroundTerminals/*` 与 `command/exec/*` 分属不同命令范围，按原生 thread／connection／generation 区分，适配器向上统一操作而不抹去身份。
- 共享 app-server 下不得为了关闭一个逻辑任务杀掉全部线程。首版 WillYou 仍按现有 run owner 保持独占启动单位；池化需要共享宿主及 thread 级授权／租约验证，不自动复制 T3 的共享模式。
- 普通本地命令成功不证明 setsid／daemon 逃逸、MCP 子树、宿主 SIGKILL、Windows／Linux 或实际 SVN 交棒。Q04／05／27／32 仍为部分。
- 原生回执和列表只是执行证据，不授予插件、邮件或其他业务权限；没有生产集成、没有正式产品验收通过率。
