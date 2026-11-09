Coalition007 实际交付

一次执行，无 App／端口／PTY／编译／提权。runner 17675、probe 17676、中间 17677、detached 17678 均实际缺席；probe 退出 0、无 signal，完整 runtime 0.152751 秒。

独立 judge 13/13。UID501 的 self 与 PPID=1 detached 子进程均 resource CID719 / jetsam720。资源读 rc=0/errno=0；started / exited 均 +2。原始 cpu_time 增量 2,049,690 ticks ×125/3ns = 0.08540375 CPU秒，detached 自身 getrusage 为 0.050545 CPU秒。对照兼容 Mach 单位与包含退出后成员；共享累计噪声意味着不据此估精确归属或 exact 时间比例。真实字段/原始输出均保持。

实际 scope 仍未批准 App：当前 CID 起点已含 883134 个 started 任务，显然广于本探针。此结果提供无需 root 的可执行补充方式：正式 T111 在 clock0 前核本人采集器与全部真实 App/Helper anchors 的 resource CID 相同、稳定 birth/CID；从开始 cut 前读取 baseline，到最后 cut 后读取该同一 CID 累计值（包含边界外成本只多算），用整个 coalition 增量 / 原有效 idle 秒作保守 upper；不减 Codex／其它任务 CPU、不替换原 own/RSS 曲线。普通子进程继承与 PPID1 实测加强完全未观测 orphan 覆盖；若任何实际 owned anchor CID不同、读取错误、值倒退或继承出现反证则 scope incomplete。上界 ≥5% 是不确定而非 App产品失败，原 own>=5% 仍独立足以失败；上界<5% 才可在范围验证完备后支持原门槛。

建议保留原 directspawn 和现有1800秒/35+5/所有阈值，增加小型 coalition raw 旁路，避免现在改变 LaunchServices 生命周期。当前尚未把旁路接入长测或执行长测；等待 root 决定后才静态补线。原 CPU58.99% 红与所有历史 raw/judge不改。

preparation-manifest.json 为开跑前13输入原清单；input-verification.json确认逐项未改。manifest.json 为最终交付清单，不含自身。
