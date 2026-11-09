Coalition 静态结论（2026-11-05，尚未执行 Native）

**值得做一次 ≤5 秒探针；当前尚不能批准 full scope。** 本机 SDK 26.5 的 `usr/lib/system/libsystem_kernel.tbd:143` 导出 `coalition_info_resource_usage`，公共 SDK 没有私有 coalition 头文件。可从 Apple 原始定义读取本人 `proc_pidinfo` flavor 20（40 字节），只向该本人 resource coalition 查询累计 CPU；不创建、改派或查询任意 coalition。

Apple [内核读取路径](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/kern/sys_coalition.c) 338–393 未要求 root；创建／改派另有权限限制。[累计实现](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/osfmk/kern/coalition.c) 721–846 合计已退出任务账与存活任务账，因此有机会覆盖 PID 采样完全漏掉的 detached orphan。[字段定义](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/osfmk/mach/coalition.h) 明确 `cpu_time` 为 Mach ticks，不能当纳秒。Apple main 源码与本机 Darwin 25.6.0 不作逐字相同假定；实际 ABI、权限、单位和退出累计由探针核。

当前 harness 第 63 行直接 Node `spawn`。[task.c](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/osfmk/kern/task.c) 1800–1838 规定普通子任务继承父 coalition，[显式改派](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/kern/kern_exec.c) 需特殊权限。因此推断 App/Helper 与 Codex 同 coalition，仍须在以后获租约的 App 前置中核各真实 PID 身份及 CID。若成立，可用整个共享 coalition 在测量区间的 CPU 增量作为保守上界；包含 Codex／采集器／其他同组任务，不能扣除噪声或当 App 精确值。上界 < 原 5% 才可能支持原门槛；超过只是不确定，原 own 曲线保留。

LaunchServices 可经 SDK `NSWorkspace.h:46,164–190` 用 `activates=false`、新实例、私有 environment 打开原包，无需改产品或提权；**API 不承诺独立 resource coalition**，须实测 CID。代价是改变已验 direct-spawn 生命周期、失去原 ChildProcess 退出句柄，并需重验私有启动参数、PID 归属、退出和焦点；目前不改 harness。直接创建 coalition／私有 spawn 改派不在本次边界内。

本目录最小探针只读自身 CID，生成一个约 50ms CPU 的合成双 fork 后台子进程，真实 PPID=1 后退出，对照同 CID 与累计 CPU／退出数；4 秒探针闹钟、4.6 秒 runner 上界，额外精确清场 ≤0.15 秒。不启动 App、端口、PTY、界面或编译器。EPERM／不支持／ABI 错即留原结果；不提权重试。即使探针全绿，仍需 App CID 前置及共享累计上界，不能据此直接宣称 T111 通过。原 58.99% own-CPU 红测不变。

SDK／已验 harness 的完整快照与 SHA 见 `local-sources.json`；官方源码链接、行段和版本边界见 `primary-sources.json`。唯一待执行命令：

`WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p069-coalition-static-007/cache python3 /private/tmp/willyou-m12-p069-coalition-static-007/run.py --execute`
