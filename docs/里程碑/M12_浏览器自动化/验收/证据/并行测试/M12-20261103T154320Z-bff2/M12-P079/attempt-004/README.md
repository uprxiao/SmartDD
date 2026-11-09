# P079004：child inventory / final race 最短 Native 预检

只准备，未执行clang/Native/OS/App/PTY。生产源023==022可复用，但本夹具不导入App代码、不改sampler，不将其当App验收或CPU<5通过。

```sh
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p069-rusage-controlled-004/cache python3 /private/tmp/willyou-m12-p069-rusage-controlled-004/run.py --execute
```

必须协调者单次Native/编译租约后才执行；execution-started.json存在即拒绝重跑。先核13输入SHA，再私有clang -Werror/link，失败停止依赖。C仅2个直接leaf+controller，约65ms合成CPU；无App/网页/网络端口/PTY/焦点/Keychain/令牌/新系统权限。controller alarm10秒、leaf8秒；runner compiler6秒、probe10秒、verifier每次2秒、judge1秒，各kill/wait短有界，整体正常<5秒、异常预算约28秒；超时和cleanup信号诚实保留。

一次执行只做两个闭环：
1. 真正live A/B→proc_listchildpids full16slot/1slot/0bytes，原始return值/全部slots/字节数与两侧guard分别保存；根据已知两PID判定ret是count还是bytes，不用SDK声明猜。A经真实waitid WNOWAIT终止未reap，再原样查列表/rusage，之后真实wait4回收再查。若列表漏zombie，就保留技术能力红，不把endpoint集稳定充完整scope。
2. B实际已经被childscan列出后才触发真实退出/wait4，再读B（预期实际ESRCH）与parent-last-counter，和实际wait4资源交叉。独立负控计算“pre-scan parent计数＋missing target当0”会漏掉多少，并明确拒绝；正向只证明这次真reap被后置parent计数覆盖，不外推任意errno3都是reap。

完整native-stdout.jsonl先落盘；每个identity是真实PID/PPID/BSD出生时间，rusage保留v1/v2原整数/start与exit abstime/错误及读窗口。BSD不可读时仍依父子WNOWAIT+原live birth绑定。保持P079002已证单位/rollup证据作为依据，本轮不重跑六语义。

runner复用002原始输出/真实code/signal/独立finally落盘流程，仅缩短预算。C/独立verifier仅对登记PID+birth+UID做清理；无法确认身份不发信号，明确缺项。普通应真实wait4、无TERM/KILL，最后external精确PID核验由执行者在租约内补齐；不把driver exit0当技术通过。独立judge中fullScopeAccountingApproved始终false，原5%/raw/analyze/source不改。
