# T130 D04/D06 App022 005 实际交付

单次真实执行已通过：D04跨根同名标签/tooltip根路径/内容和独立草稿；D06 dirty预览被固定保留且B独立可看。原独立judge4/4（含A前置、文件完整性和正常退出），不重跑D12/D13或任何已绿U，不声称整条T130/T145通过。

执行session79627、driver64839、App64841。实际首次Native+DOM+visible连续3039ms后才安装一次guard，初次等待147557ms；automaticActivations=0，无yield/rearm，实际受守卫输入227次。两段业务结束后before-quit/will-quit/quit与真实process-exit0均有记录，App0/null，signals=[]。

原cleanup和追加独立cleanup均allClear：包含driver共8PID absent、2TCP57290/57287 closed、2Unix socket及其目录/tmp/wy-501-KulfH4和/private/tmp/wy-cli-501-AEau4Z absent、private TMP无socket。无需强杀或重启。已向Root明确释放全部Native/App/UI/FileBroker/OS/PTY/HTTP/TCP/Unix资源，整理不占资源。

36冻结执行输入及关键包文件事后只读核不变；旧003焦点超时/004旧包静态稿均保留。runtime-001/result.json是原真实raw，result.json是原judge，未修改。交付manifest只带测试代码、合成证据、清场与生命周期；不含整个userData/DB/home/codex/tmp/cache/日志或App。

Root可只读重判：
```sh
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t130-app022-tabs-005/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t130-app022-tabs-005/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t130-app022-tabs-005/judge.mjs --judge-existing
```

此前静态manifest.json保持原SHA，最终文件清单为delivery-manifest.json（不含自身）。正式唯一用例归账由Root统一处理。
