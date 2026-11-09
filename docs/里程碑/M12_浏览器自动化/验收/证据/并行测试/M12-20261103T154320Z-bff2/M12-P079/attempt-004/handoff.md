P079004短预检已执行一次并全部精确清场，资源已释放。执行命令为冻结run.py --execute，exec直接终态（chunk ec3eca），没有后台session。

真实runner92269、compiler92271、probe/controller92285、A92286、B92287、verifier92290。compiler -Werror/link0，binary b04e017a87965f91c94a112edf06972ff5926804cb5e9c21f1b7c6f0b2dc7130；probe0/null，无fallback；C实际约44.496ms，整体原命令约0.269s。原judge18/18，完整scope批准仍false。

实际数据：
- proc_listchildpids的64-byte/16PID容量、两个真正live leaf返回2，前两slots为A/B；因此此调用return单位是PID个数而不是字节。
- 4-byte/1slot只返回1且仅写一个PID，仍errno0，不能当完整清单；必须把ret==capacity判可能截断，增容/复核，不可把它解释为全部只有1个。
- NULL/0bytes查询返回1180而非本次真实2个child；只保留原值，不将它当精确child个数或推定它代表其它范围的真实总数。正式collector不依赖0bytes返回作完整性证明。
- A的真实waitid WNOWAIT确认终止未reap时，列表仍同时含A/B；BSD对该zombie bytes0/errno3，但v1/v2仍可读、同startAbstime且exitAbstime非0。真正wait4后列表只剩B。
- B先真实被childscan列出，然后才触发退出和真正wait4，之后target API确实errno3。后置parent child增加35.1605ms，与wait4 35.159ms吻合。
- 独立坏算法负控：若用scan前parent child并把missing target当0，只计30.168375ms而不是后置65.328875ms，实际漏掉35.1605ms，判定明确拒绝。这个正例仅证明已知真实reap的覆盖，不宣称任意missing PID都是reaped或全部生产竞态已闭合。

原始native stdout/rusage/slots/guard/PIDbirth/真实wait4/exec code与原judge均不改。外部ps对六个明确PID全部absent，C verifier三birthclear，无TERM/KILL、无App/UI/PTY/网络/Unixsocket/hooks。

下一步可将上述API语义接入私有正式collector：direct-child自有效容量起，ret==capacity必须扩容，include unreaped rusage；children-first/parent-last-counter仅在保留根和真实归属闭合后补漏。仍须对App019的完整基线/固定daemon身份、未知orphan和finalcut并发失败关闭。不能用瞬时endpoint集合稳定充fullscope，原T111003红/5%/分母/峰值/source023/生产sampler均未改。
