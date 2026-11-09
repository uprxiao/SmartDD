# Darwin 子进程累计最小受控验证计划（未执行）

状态：STATIC-ONLY / NOT-READY-TO-EXECUTE。当前协调者独占 Native；本目录无程序、编译或探针执行。后续必须由协调者单独授予短原生租约。该验证不是 App A、不是原 T111 长跑通过，也不改变生产源码/App。

## 资源与记录边界

未来使用一个隔离的测试 controller、一个长期外部 libproc reader 和串行的合成 child/grandchild。无窗口/激活/网页/网络/端口/PTY/系统剪贴板/Keychain。所有控制通过私有 pipes/files，PID+真实出生身份逐个登记，禁止全局进程匹配或清理日常进程。CPU 工作量仅为得到可辨计数的短有界合成负载；每阶段均有墙钟上界和精确自有清场。

先冻结实际源码、编译输入/依赖、SDK 结构布局（含 sizeof/offset）、binary 与执行命令，再申请租约。不得仅凭 SDK 头文件将计数单位写成 ns；先输出 uint64 原值。以同一进程自身 getrusage(RUSAGE_SELF) 的 timeval 秒数、以及 controller 的真实 wait4 rusage 作为独立交叉，不以墙钟 sleep 时间充 CPU。保留原始整数、采集窗口/单调时间、全部 PID/birth/PPID、每个控制动作、wait/exit 状态和所有不确定性。

## 六项串行语义门槛

| 项 | 精确控制与采样 | 必须回答的问题 |
| --- | --- | --- |
| V1 自身/单位 | controller 无 child；短 CPU 段前后取它自己的 getrusage、外部 proc_pid_rusage 原值 | self user/system 单位和布局是否一致；child 是否静止；累计是否单调 |
| V2 活 child | child 工作后报告自身 rusage 并在 pipe 门闩等待，不退出；外部读 parent 与 child | parent child 字段是否包含活 child；live frontier 应如何避免重计；外部读取权限/身份可靠性 |
| V3 已退出但未 wait | 保证 parent 无 SIGCHLD 自动回收且不调用 wait；child 退出，保存真实 zombie 状态再读 parent/zombie | parent child 何时变化；zombie API 是否可读；不能靠猜测 wait 时才计入 |
| V4 已 wait/短 child | parent 对 V3 执行真实 wait4 并保存 rusage；再次读 parent；另一个 child 完全在模拟 5 秒边界之间完成并 wait | child rollup 时机/总量与 wait4 一致性；此前活 child 信用如何转移；完全未被枚举的 child 能否补入 |
| V5 孙进程 | C 工作，C→G 工作；G 活→zombie→由 C wait→C 退出→由 parent wait，每个阶段分别采样和保留 wait4 | child 字段是否递归包含孙进程；两级 rollup 后 CPU 是否恰好一次；F 或 ledger 是否保持连续 |
| V6 显式 daemon reparent | M 创建 D、报告 D 的 PID/birth 后 M 退出，由 controller wait；D 在私有门闩保持活着并核真实 PPID 变化，再结束 | D 脱离 owned ancestor 后如何作为独立 root；D 终止最后 CPU 去向是否能闭合；不能仅靠 wrapper 最后一次自报 rusage 伪称捕获实际退出余量 |

V3 的 zombie 读取是受控动作，不是假定每个生产短 child 都能被 5 秒采样赶上。V6 若发现外部已 reap terminal CPU 无来源，就明确宣告该方案对该类 reparent incomplete，不能因为其 CPU 小而省略。不得让 daemon 成为测试残留；保留终止前后身份及准确清场。

## 不双算与覆盖验收

依据 V1–V6 的真实语义再选 cumulative frontier 或等价转移 ledger。对固定实际 trace 逐步核算：活 child CPU 不进入父重复项、已 wait 的累计只转移一次、孙进程两级只计一次、完全隐藏 child 不漏记、PID 复用与未知 parent 不误合并、非原子读取可辨不确定性。

若需要采集顺序负控，应只在这个合成 trace 上延迟读取造成 rollup 竞态并验证判定器拒绝 uncertain，不改变 App/Node 的 spawn/wait。父子计数切换、单位、重父化和 terminal CPU 任一未闭合则不能进入 full-scope <5% 通过判断。提高采样频率不是闭合证据。

## 之后的接入与新长跑（仍待批准资源）

通过上述门槛后才做私有 sampler 补充草案：保持原 5 秒 raw/RSS、原 CPU 5% one-core、原 idle/activity 窗口及全部峰值；新增 rusage raw 和独立 full-scope adjudication，不覆写原003分析。再用纯数据 trace 单测证明隐形 child、wait 转移和 reparent 缺口不会被误判通过。最终新包长跑仍需协调者提供 source020/App019 最终 PIN 与完整租约，1800 秒、35 正式+5 warm 和原阈值全部照旧。
