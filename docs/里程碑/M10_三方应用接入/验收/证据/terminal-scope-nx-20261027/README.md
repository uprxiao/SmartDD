# NX T37 跨项目与新PTY真实界面证据

2026-10-27，feature/0.0.2，HEAD f1f1728d68a8595e665d4833dff048189e63e0f8＋可恢复工作区。R1.6＋§12.21；正式32/72、余40，T37部分，目标active、未发布。

最终2yMFcQ：原7基线＋6专项＋profile1＝14通过；CrRtLD默认8回归通过，不累加为正式用例。实际UI关闭详情/选不同项目新建B，再放行A原已校验binding；或UI停止/恢复A产生新PTY/同native ID后放行旧binding；都仅release、不写入新目标/提交/自动建Task/抢焦点。原项目详情在B当前Task下disabled，真实指针尝试无bind/write；fresh详情能投递A新PTY，B前缀保持。gate只延迟原terminalBind返回，原event/args/授权/结果和insert不改，故障层明确标记。

原App、Composer、Codex0.162.1、PTY、MCP、SQLite真实；Responses/邮件样本合成。零日常凭据/钥匙串/SMTP，Bug/Story认证A层依用户安排留后，不用SecretsStore替身绕过。没有Claude、真实模型推理、系统IME/剪贴板或当前P层通过声明。

5批原结果保留：首composer默认项目夹具失败、wait转义表达式失败、Apps全屏导航入口夹具失败，以及专项/默认绿测。fixture-source-correlation.json匹配每份实际helper hash到保留源；不改产品默认或删失败求绿。verification.json独立核对3run/5进程终态（B仅cli）/lease释放、原A S/refs/identity和两草稿/修订保持、物理来源字节、两个原生ID/不同cwd。16登记App/CLI/桥PID均已确认退出；不宣称所有未登记健康检查子进程。SQLite只读新建零字节WAL单独保存，非空DB/WAL保持。

复用NW3 App /private/tmp/willyou-m10-nw3-package-20261027/mac-arm64/WillYou.app，ASAR1da1ff6a7dadfa5a1e4726bfce309fceaea040c1d54307093868da151ce8fa37，App0.0.5/Electron42.11.14/macOS26.6.1 arm64。19pin、18352非Finder out保持，生产未改；沿用NW117软件/类型/6原生，本轮未重跑。原型未改，当前源1284→1285，仅一原外部parent修改＋一个新外部helper。source-overlays叠加[上轮NW可恢复链](../ui-focus-nw-20261027/README.md)得到当前完整选定输入，source-before/source-first/current-source-baseline分别保留。没有复制原数据库、原生profile、安装包或日常数据进仓库。

[本轮执行记录与原T37缺项](../../NX_T37跨项目与新PTY真实界面补验_20261027.md)。原72定义保持，不因跨项目/PTY通过就宣称Bug/Story或整例通过。下一项继续原T14当前真实UI范围保存/在途范围呈现缺项。
