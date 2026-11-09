只读静态审查已完成。review.json 包含 23 个源码/SDK/psutil 逐字段来源快照与 SHA、原003 raw/曲线/判定/清场的只读引用哈希。未执行 Native、OS sampler、编译器或 helper，没有监听或待清理子进程，未占租约。

结论：原 sampler 不能覆盖两次枚举间完全出生并退出的短 child；原观测身份稳定不是该类进程不存在的证据。原 58.98563893755239% 是已测 own CPU 的贡献，仍明确失败。未来 observed <5% 在 full lifetime scope 未闭合前不能判整条绿。

补充方案与最小六项受控验证均为未执行静态稿。Darwin SDK 的 proc_pid_rusage/child 字段存在已证实，但单位、live/zombie/wait rollup、孙进程及 daemon reparent 语义尚未实测。禁止将外部 sampler 的 getrusage(CHILDREN) 充 App CPU，禁止简单将 live own 差分与 parent reaped 差分相加。下一步只能由协调者评审并独立移交短原生租约；不需要改生产 App 来完成此测量边界验证。
