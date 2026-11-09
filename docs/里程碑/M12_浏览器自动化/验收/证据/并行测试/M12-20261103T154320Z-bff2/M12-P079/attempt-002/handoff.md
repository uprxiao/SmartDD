P079 controlled rusage attempt002 已真实完成并清场，全部Native/编译资源已释放。001原source/raw/judge/probe1未改，002原judge/result也未改。

实际session90878；runner31844、compiler31846、controller31869、direct child31870、hidden child31871、nested child31872、grandchild31873、intermediate31875、daemon31876、精确verifier31886。compiler -Werror/link0；probe0/null、无runner强杀；所有子wait4为0/null；C正常收尾未发TERM/KILL。外部ps对上述10个PID全absent。无App/UI/PTY/网络端口/Unixsocket/hooks。

真实六控及原judge13/13不等于全scope计量批准：
- 此机v1/v2原值按Mach ticks换算；timebase125/3、24MHz。own delta2,040,763=85.0317917ms，对照getrusage85.032ms。
- 活child约120.239ms时，parent child=0；waitid WNOWAIT确认未reap时仍0；真正wait4后parent child+120.2655ms，对照wait4/getrusage120.265ms。
- 受控zombie的BSDinfo bytes0/errno3，但v1/v2都可读且exitAbstime非0。保存原live出生身份+真实父子WNOWAIT关系，没有把BSD失败当不存在。
- hidden child在约75.732ms两次parentCPU边界之间完成，没有其目标CPU快照；parent child+75.2464ms，对照wait4 75.245ms。
- 孙75.201ms先由child回收，再child由controller回收；最终parent child增加120.7195ms，对照子树wait4 120.717ms（包含child own）。两级累计没有再次添加孙的历史CPU。
- daemon真实PPID由31875变1；live110.1787ms。显式EXITING消息后的快速读偶然捕获真正terminal110.21025ms，随后约11.635ms就errno3。controller在intermediate回收后child新增仍0，故ri_child并不保证把脱离父树的daemon最后CPU回收到原controller。5秒不能保证捕到这个terminal窗口。

独立scope-adjudication.py/json只读原raw，纠正原judge一个描述性字段：原liveOnly用BSD status!=5，把BSD读失败status0的实际zombie误称live。13项检查未依据它批准fullScope，但该描述仍应勘误；原judge/result不覆盖。纠正使用真实WNOWAIT+v2.exitAbstime，保留原status0，不伪改为5。

实际unreaped frontier在nested各阶段约403.564→403.653→403.693→403.732→403.758ms，仅正常新增CPU；真正live-only在grandchild未reap时降至328.451ms、child未reap时降至283.012ms，回收后才恢复。这说明不能只把活PID own和parent child直接凑成全范围累计；必须处理未reap信用和后续rollup，不能双算，也不能把下降clamp成0。

结论：可用ri_child补上本次实证的已wait直接/递归短子树；未reap边界、全owned身份发现/转移及daemon terminal仍须闭合。fullScopeAccountingApproved保持false。原T111003 58.99%红/曲线、CPU5%/周期/活动区间和source020/021生产不改。不新增Native，下一步由协调者审查是否以及如何接入独立计量补充。
