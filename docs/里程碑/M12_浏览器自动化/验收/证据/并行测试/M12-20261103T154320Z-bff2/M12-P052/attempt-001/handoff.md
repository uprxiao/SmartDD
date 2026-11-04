# M12-P052 attempt001：终端前置遗漏，T106未执行

真实App013启动、健康profile/受管Python根/M11环境、setup reload、初次native+DOM焦点及fresh guard成立；通过真实UI创建并导航网页。之后等待.xterm-screen超时，没有输入RUN，没有执行任何CLI，未取得三命令或19/21秒截图。T106、T114、T115均不计通过。

原raw和judge保持不改。judge按缺失业务输出6红，result明确是前置失败和未执行，不能当成产品活动标记已测失败。failure.png已实际查看，左侧显示“未开始/还没有发过消息…/启动”，底部显示1个运行中；不是仅凭CSS位置猜业务。

冻结源确认：RPC tasks.create绕过renderer tasksStore.create绑定；reload清除仅本窗口的terminals内存；auto-resume有task.ptyId时刻意不重复启动。StoppedPanel真实“启动”按钮[data-testid=task-resume]经tasksStore.resume调用tasks.open，TaskService.openOnce对已运行任务直接返回同一PTY，随后renderer绑定。source-snapshot/fixture-cause.json保留对应源码及SHA。协调者已认可新attempt仅补这个真实UI前置，要求read-only核PTY/PID不变；不改生产、不调RPC触发CLI、不重新武装guard。

准备期manifest字段误用fileModes而实际modes，被静态截住，无App/native；preparation-failure-001保留。初ready至执行前只有will-quit观察文件去尾换行双转义的小调整，ready-hash-history记录旧/最终hash和原因；最终preflight9df8a080…与driver aa92330d…经协调者认可并实际匹配后才执行。

App ASAR5956ffaec1ad9765086789872e36477dd38ea7a0e0c32778c80359675ad60472，3451生产输入SHA全部未变。driver依赖从P033私有已核输出复制，初始preflight核ws8.22.1/TS5.9.3版本；本次结束后dependency-hash-final又逐文件匹配全部旧SHA，下一attempt会将此完整检查前移到启动前。

原session82522正常结束；driver8779/App8781/受管根8883，App真实will-quit/exit0、无forcedClose，清理先停本次合成任务，未发送浏览器业务。8精确PID 8779,8781,8782,8783,8816,8883,8929,8930 全absent；数字端口57301,57307,57302,57355全closed；私有TMP无gateway/Unixsocket；Helper推导短目录/private/tmp/wy-ab-3ef6c7c6bec670fccb45654c无pid/sock/stream（未调用Helper）。资源已明确释放，之后仅静态归档。

合成0.166版本/健康/requirements协议只是前置，非真实Codex模型R或OS沙箱；实际TaskService/PTY/M11与固定CLI路径已在receiver-ready证明，但CLI调用计数0。没有剪贴板、日常凭据、外网或业务RPC替代。新attempt必须新目录、重新预检和新资源租约。
