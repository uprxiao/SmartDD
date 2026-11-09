P079 controlled rusage attempt001 已完成一次真实执行，当前全部资源已释放。原静态 preflight/源码、编译门槛0、真实 raw、原 judge 与失败均保留，未修改原T111003或生产源码。

实际：runner15126/session43027退出0；compiler15129 -Werror/link退出0；probe15142退出1/null，不是超时强杀；direct child15145；精确verifier15175退出0。外部ps对这5个明确PID全部absent，未开App/UI/PTY/端口/socket，也无hooks。driver退出0不代表六项通过。

六控未闭环：V1自身与V2活子已得到真实数据；V3假定PROC_PIDTBSDINFO能读到SZOMB的观测门槛2秒未满足，原error为zombie-bound errno60。它没有记录每次BSD失败载体，不能从这个失败推断proc_pid_rusage不支持zombie。V3后段/已wait/隐藏child/孙/daemon均未执行，原judge7/10且status failed-or-incomplete、fullScope=false。

已得语义：此机v1/v2 own原值与Mach tick换算吻合，不是ns。timebase125/3，24,000,000 raw units/sec；own delta2,040,442=0.0850184167s，对照getrusage85,019us。V1/v2差异最多约6.21us。V2 child实际self约120ms时parent child raw为0，仅说明此受控live时点未计入，不外推wait/递归。

建议下一次仅修夹具观测：本机SDK wait.h明确WNOWAIT使目标保持waitable；以waitid(P_PID, child, ..., WEXITED|WNOHANG|WNOWAIT)的真实siginfo确认终止但未回收，再读原v1/v2并保存BSD失败/errno，不要求BSD必须返回zombie。fork/wait4/CPU工作/SDK原值保持，单位沿用真实timebase继续核。不得用wait4(WNOHANG)确认zombie而提前回收。需要新私有attempt和协调者显式Native租约，当前不重跑。
