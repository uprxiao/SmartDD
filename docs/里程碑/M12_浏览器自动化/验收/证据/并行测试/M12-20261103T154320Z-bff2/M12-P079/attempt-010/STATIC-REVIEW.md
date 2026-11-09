LaunchServices 最小可审静态稿（010；不宣称 runtime READY）

**未编译 Objective-C，未启动 App／broker／kernel helper，未做 OS 查询。** 静态 Node 语法、未绑定标识符、Python AST、5 个动态 CDP 表达式和12项纯数据判定控制已通过；Objective-C真实编译与公共API行为待新租约，不能把 token 检查当语义绿测。

拟一次执行命令：`WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p069-launchservices-probe-010/cache node /private/tmp/willyou-m12-p069-launchservices-probe-010/run.mjs --execute`。此命令只在协调者明确新租约后运行：COW逐字复制已验App019至本根唯一 `app/WillYou.app`，核固定资源／主程序／Framework SHA、原签名与无quarantine（不删除／绕过）；Werror私有编译成功才发一次公共NSWorkspace请求。无新长测、无模型、无用户凭据、不改产品／ID／签名或共享harness。

broker 为 prohibited 的无窗口进程。NSWorkspace exact私有URL、新实例、禁止替换、禁止激活、隐藏、私有HOME/CODEX_HOME/userData/PATH与原调试参数。只记录精确回调实例；其后依次核本次UID/birth/startAbstime/exe、两个端口确属回调PID，才连接本次main inspector，只读核实际userData/ASAR/exe/env名字和窗口焦点。再核实际App metric PID与runner/broker的resource CID及各组累计读取权限。仍共享host CID、权限不支持、意外激活等均保存并正常收尾，不启动30分钟；不同CID也不代表专属或CPU已低于5%。

被动App before-quit/will-quit/quit/process-exit-event观察只向本根写固定字段，不改handler返回／鉴权／ready。实际App.quit请求后断开自己的inspector，等待同一NSRunningApplication terminated，再核原生birth身份消失、两个端口关闭及仅本次唯一clone路径的进程无残留。失败时只向该回调实例发送普通terminate，不按bundleID终止其他实例，也不发全局kill。清场不闭合则明确unresolved、不可宣称释放。App kernel exitcode/signal恒为不可用null；broker0和App quit事件code0绝不冒充waitpid状态。

**尚有公共API边界：** LaunchServices请求没有本稿可证明的取消保证。若发出后回调长期未知，broker继续观察，runner记录`launch-callback-unresolved-lease-not-released`／`cleanup-unresolved`，不因超时杀broker就宣称无未来App。此类状态需协调者接续处理；没有安全自动释放保证，因此本交付是静态可审稿，不硬凑可无人值守runtime READY。正常已取得精确回调实例的关闭路径已实现，但未实测。Gatekeeper仍可能系统提示；无quarantine检查不能承诺系统永不提示。

`static-preflight.json` 是静态事实，`native-api-provenance.json` 关联已实测long004的精确Native只读类，`cached-primary-references.json` 固定已缓存SDK/harness SHA；`judge.py` 单独读真实raw，不按broker退出码判App退出。若此未解决的迟到回调边界或非子进程退出边界不可接受，应保持proposal，先由协调者决定是否允许编译门槛与一次最小实际探针；本稿没有提前运行授权。


010只修必要前置：009实际JSONL已正确（4LF/0literal slashN），保持原转义；新增真实生成表达式往返和刻意多转义负控。009原13文件完全未改，010最早误要求009必红的纯夹具断言已留 preparation-errors.json。主端口归属通过后，只读有界等Electron app.ready且出现本私有ASAR的file窗口，之后才检查renderer端口。保留原始callback URL/POSIX path，Node realpath与Darwin realpath精确对齐唯一本组App/Exe/ASAR/private目录，再核UID/birth和既有文件PIN；其它日常不同路径不接受。普通terminate控制还要求本实例PID、canonical包/可执行路径、nonce及再次读到的同一Native UID/birth；不按字面/tmp别名错误留下自己的实例。

强归属/private env通过之后，先记录实际DOM/native焦点与App/host CID/累计权限，再独立判原非激活门槛，不新增active launch、不输入UI；即便非激活失败，CID事实也已落盘。原非激活断言保持，晚回调不可取消与kernel exitstatus未知边界原样。新增5项纯数据ready/path校验只验证上述必要前置，不模拟Native成功；Objective-C依旧未编译。
