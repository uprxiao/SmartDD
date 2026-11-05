T120＋T125 attempt002：静态可审执行稿；未启动R/Native/App/HTTP/模型/认证读取，正式新增0，资源[]。

原合同仅两条：T120（R08.1/R08.5）真实Codex读完整Bug，按正文环境/qa账户用stdin密码登录、snapshot核账号、按原步骤实际复现20.01并保存截图等证据、报告环境/账号/步骤/路径。T125是同任务后续真实UI消息，Agent在默认沙箱/审批下分析并修改本机业务源码、自己重启确属本项目服务，在同一profile按同步骤看到20.00、重新取证并报告前后对比。contract.json把原合同与新payload额外顺序/范围要求分开；不包含T123/T124。

包/source：App021/source025，ASAR 7b63bb817a9047656f4fe268fae4a4ea20d2f17b472c6dce417dccad837d0fd6；source manifest fc0804c493320514f4938d76755c6d0bdc9aa42adb41c30813ffedafaa74b6c9。固定真实Codex0.166/defaultworkspace-write/on-request、CLI/Helper6b/identity/Skill资源按pin和实际包manifest。T121冻结223输入逐项核SHA/mode后复制到这个新根，旧根没有修改，也未复制旧raw/live/started/auth。复用完整owned Skill目录三层哈希、原Native JSONL/有限AST/Host实际actor和回执、readonly页面取证和真实正常退出/精确cleanup。

两个明确的新prompt及合成Bug在payload-review.json。第一轮明确先复现并等下一条消息、不修源码。第二轮是一条物理行，通过同一终端UI先Ctrl+U清当前未提交行，再插入精确文字和Enter；后端必须观察真实新user message、同task/PTY/native session/currentrun，不能只凭界面输入声称送达。新prompt允许正常本机开发所需单次工具审批，保持on-request和workspace-write；require_escalated只是请求而非自动授权，driver不自动批准、不设never/fullaccess；实际策略旁路仍拒绝。若审批阻塞，原raw保存为partial，不换策略重试。

F-SITE是真正项目源码：site-template/pricing.mjs初始计算10×2为20.01，server.mjs是真实loopback服务，不能靠fixtureflag切结果。未来setup把原审核模板复制到本次project后，宿主只允许初始启动一次；spawn前逐字核模板，绝不启动、import或eval模型修改后的代码。服务后续重启只能由模型真实工具在原沙箱下完成。M10只读夹具独立监听43548，F-SITE进程监听43547，M10宿主没有/site路由、不能制造F-SITE计算或登录。M10随机连接token只在宿主内存和本次App合成连接，绝不写项目/runtime.json或prompt。站点自己的固定HMAC会话密钥是非秘密合成数据，保证真正服务重启后同profile Cookie可保持登录；不接触真实auth。

服务事实：真实OS端口唯一PID、UID/birth、canonicalexe/cwd、server路径与只读/__m12/identity交叉；保存初始child真实exit、前后PID/birth/boot/port、源码全文与SHA、业务页面20.01→20.00。源码只按文本读取，绝不在宿主执行改后代码。项目内site.events是可被模型修改的项目文件，不能单独当权威；它与独立Native/Host/浏览器DOM、截图/HAR及OS归属/源diff共同供Root复核。M10完整HTTP日志则由宿主保存，必须全GET/HEAD、无写尝试，即使405拒绝也不允许。

独立判定：T12012项原始证据链，T1258项source/restart/sameprofile/actual20.00/新证据/最终前后对比，另6个全局plan/policy/焦点/cipher/正常退出/精确cleanup门槛。Browser按实际manifest区分read-only与completed，不能套M10只读限制。截图/HAR文件逐路径、mode、bytes、SHA/格式核验；console/network支持生产的inline或artifact返回。缺child numeric exit保持null；完整CLI v2与同当前Host成功账可证明业务完成。一般运行session必须真实终态，T125有明确Node server.mjs原请求＋实际owned listener时可保留服务后台running，不把它伪成exit0。有限literal apply_patch只解析真实AST/字面patch/path/call_id/output，禁止修改runtime身份/fixture设置或项目外文件；未知格式保留原始且最终partial，不eval、不因格式未知提前kill正常授权任务。

已执行纯检查：24项case/服务身份/原始patch/审批/负控，14项新collector/finally纯控，6项已知有限载体控制，6组源码/固定label/真实生成CDP/SQL/harness/一次guard预检；所有实际脚本Node语法与CheckJS未绑定名检查。另按真正openElectron正常顶层return对象核App接口（非includes）：本组69处、冻结T12164处真实app方法/属性使用全部有实际return/guard赋值来源，missing=[]；移除真实observedProcess顶层成员的纯负控可识别。T121冻结输入未改。4个真实生成表达式及字面CDP检查通过。语义其他动态类型诊断保留，不冒称全项目types绿。准备期3个纯脚本/fixture错误和1个过宽source-action regex负控失败保留preparation-failures.json；没有触发Native或模型。未进行实际监听、服务重启或App/真实终端续问。

未来唯一准确运行命令（Root审稿、新确切两prompt发送批准和独占租约后才可运行）：

    WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t120-t125-sop-static-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t120-t125-sop-static-001/cache/node node /private/tmp/willyou-m12-t120-t125-sop-static-001/run.mjs --execute --authorization /private/tmp/willyou-m12-t120-t125-sop-static-001/authorization.receipt.json --lease /private/tmp/willyou-m12-t120-t125-sop-static-001/lease.receipt.json

仍需前置：Root核新payload并在用户醒后申请本组确切发送批准（旧G1/T043/T121不覆盖）；一组Native/UI/PTY/两个HTTP/Helpers/OS只读收尾租约；初始一次真实前台，完成所有RPC/health后一次reload，exactown Native+DOMvisible3s后freshguard；第二轮终端输入时仍需前台且guard未yield，失焦后不激活/rearm。可能出现的实际工具审批由用户真实单次处理，不由测试自动代答。每轮模型600s、整driver1800s有界；真实服务属于本项目但当前沙箱能否停止/重启仍是runtime gate，不预称支持。

未来收尾后独立核验并判定：

    WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t120-t125-sop-static-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t120-t125-sop-static-001/cache/node node /private/tmp/willyou-m12-t120-t125-sop-static-001/verify-cleanup.mjs --verify
    WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t120-t125-sop-static-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t120-t125-sop-static-001/cache/node node /private/tmp/willyou-m12-t120-t125-sop-static-001/judge.mjs --judge

只停本次任务/App、强绑定UID/birth/cwd/exe的本项目服务及自己的监听；身份不明不杀。真实App0/null和signals[]与测试清理分开；记录Gateway实际socket/dir、每页Helper运行文件及所有已知PID/TCP，含driver实际birth；任何cleanup错误先保持resourcesHeld=true，独立外部核清后才释放。第一轮捕获完成即把phase/原始prefix独立落盘，再进入续问；T125未执行不抹掉T120有效事实，也不自动计整条通过。原始journals/auth/private数据/修改后项目只留私有runtime，未来仅safe metadata归档。当前所有receipt模板保持NOT-authorized/NOT-granted；用户睡觉，本轮未询问或发送。

002修订（001原静态绿及限制保持冻结）：只修source采集和finally证据。普通.git/node_modules/.agents/.codex/.cache等目录或相应软链只记录lstat排除元数据，不递归/不跟随、不因存在判新scope。pricing.mjs/server.mjs/runtime.json/README仍要求真实regular文件、精确路径、O_NOFOLLOW、actual bytes/mode/dev/ino/hash；其他源码按原256files/4MiB单文件/16MiB总量有界采集。解析静态imports及已知文件输入，仅执行静态AST；移入未采集依赖、bare/dynamic loader、缺失来源均产生coverage gap，T125保持partial并交Root审源码，绝不悄悄通过。各阶段source snapshot另外0600模式独占落盘并由独立judge重新读取比hash/content。Native/Host/prefix在source checkpoint之前先保存，collector失败不吞原业务事实。

cleanup-ledger对每步API、私有log、raw/live分别隔离错误；每步finally保存，最外层finally在cleanup.actual前后再次保存raw/live，任何未闭合资源/持久化问题保持显式。新14控覆盖缓存出现不误伤、关键源missing/directory/symlink、真实mode/byte读取、排除依赖/未知/超界和注入clean/log/persist失败后仍走后续及terminal保存。新helper仅host测试代码，未修改App/公共生产/001冻结。新payload未变：c796d7581eb4631c9d143463d82101fcf3fc01a574f70aeddcc712d5f2be5eed，授权/租约仍pending；未运行任何R。
