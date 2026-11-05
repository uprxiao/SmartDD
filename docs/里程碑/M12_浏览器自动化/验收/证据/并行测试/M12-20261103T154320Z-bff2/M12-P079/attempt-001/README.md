# P069 六阶段 Darwin rusage 受控验证

状态：只完成静态源码/SDK/AST 预检；未编译、未运行 Native/OS 探针，没有 App、窗口、端口或 PTY，不占 Native 租约。新测试源码不修改 source020、App019、T111003 raw/analyze 或阈值。原 T111 58.99% own CPU 红测及曲线保留。

## 执行（必须先收到协调者 Native 租约）

```sh
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p069-rusage-controlled-001/cache python3 /private/tmp/willyou-m12-p069-rusage-controlled-001/run.py --execute
```

单次根，存在 execution-started.json 即拒绝再跑。run.py 先逐项核 static-preflight.json 中的 source/runner/judge/SDK/clang 字节，再在私有 build/ 编译一次 probe.c。-Wall -Wextra -Werror / 链接任一失败即不启动实验。-MD 保存真实编译依赖闭包和哈希。当前未声称 C 编译或 ABI 正确；它们是租约内第一道实际门槛。

预计资源：编译器及其本次工具链子进程；controller、direct child、hidden child、nested child、grandchild、intermediate、daemon 共 7 个已识别 Native 身份，完成后单次 exact verifier。无外站/网络/设备/用户焦点/Keychain/剪贴板。CPU 合成工作总量约 0.5 秒，实际 CPU 计时达到阶段目标后停止；每个 burn 最大 3 秒墙钟，每个 pipe 等待 6 秒，controller 40 秒 alarm，runner 48 秒观测上界。异常一律保留真实 code/signal/cleanup 信号，不能重新刷新次数求绿。

## 六项真实阶段

1. V1 controller 无 child，自身工作前后同时取 libproc v1/v2 原始 own/child 整数，以及 getrusage(SELF/CHILDREN) timeval 对照，记录结构大小/offset/timebase。单位由数据标定，不因字段名预设纳秒。
2. V2 direct child 完成 CPU 后保持活着，在 pipe 门闩等待；读取真实 parent/child PID+birth+PPID、self/child 累计。
3. V3 parent 保持默认 SIGCHLD、尚未 wait；实际观察 child BSD SZOMB 后读取 parent/zombie。不会将“能读此受控 zombie”推断为 5 秒能捕全生产 zombie。
4. V4 正常 wait4 保存真正 user/system 与 exit status，再读 parent；另外让 hidden child 完全在两次 parent CPU snapshot 之间完成并 wait。保留其 identity/self oracle，但不对 hidden child 做目标 libproc CPU snapshot。
5. V5 nested child→grandchild 活/未wait zombie/已wait/child退出/parent wait 全部阶段，保存每次真正 wait4 与 parent/child/grandchild 快照，区分 live-only 与 unreaped frontier，未预认递归包含。
6. V6 intermediate→daemon，先记录真实旧 PPID，再让 intermediate 正常退出并由 controller wait；读取 daemon 的实际新 PPID、工作后 CPU、退出前 oracle、退出后 API 和最终身份消失边界。self-before-exit 不等于完整 terminal CPU；偶然捕到一个 zombie 不足以保证未来 5 秒覆盖。本项即使执行成功，也不会据此自动批准全 scope 计量。

## 原始载体与独立判定

native-stdout.jsonl 原样先落盘，所有 uint64 字段保留整数；每次 snapshot 包括 reader/target PID、BSD birth/status/PPID、v1/v2 返回/errno、raw own/child、start/exit abstime、单调时间读窗口和 reader getrusage。wait4/pipe oracle、child identity 和确切 cleanup 均分别记录。native-stderr.log、execution.json、build 日志与依赖、owned-identities.json/tsv 独立保存。

judge.py 只读这些数据，不调用 OS API，不靠进程 exit0 推业务通过。它校验实际六阶段、单位比例、v1/v2 对照、短 child/wait4/孙进程参考，并输出实际 live/zombie/wait 计入阶段。4ms/3.5% 仅用于短夹具非原子计数的语义交叉比较，绝不调整原 T111 CPU<5%/活动区间/峰值。fullAppLifetimeScopeAccountingApproved 始终 false：下一步需协调者审查真实语义并实现/验证 accounting ledger 才能用于未来长跑。

## 精确收尾

C fixture 的全局表仅存亲自 fork/明确 pipe 交付的 PID+BSD出生身份。普通流程均 wait4 或确认 daemon 原身份消失；normal cleanup 不应发任何信号。异常 cleanup 只对同 UID、PID+birth 精确匹配的已登记身份发送 TERM/KILL，保留信号和当前状态，不清理未知或日常进程。runner 等待真实 controller code/signal，再调用私有 binary 的 --verify-list 对这些固定身份逐项查验；必要时仅对精确匹配者清理。父子 pipe EOF/alarm 是辅助退出上界，不充“已正常退出”。原始落盘与判定/清场分别隔离，后者失败不会吞掉 raw。无生产 hooks。

编译器 timeout 时停止依赖 Native；其原始启动 PID/返回/信号仍留存。任何未能证明的 toolchain 后代收尾按缺项上报，由协调者核实，不能伪造全清场。当前只静态准备，不调用 ps/lsof/libproc 进行预先测试。
