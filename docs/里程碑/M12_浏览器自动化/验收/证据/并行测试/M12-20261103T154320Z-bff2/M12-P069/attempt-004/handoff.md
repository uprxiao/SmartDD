M12-P069 long004 最终交付

原App019/source023/原driver单次实际运行；没有重跑005、没有更改App或原六脚本/阈值/采样点。全部32运行输入执行前后SHA相同；原准备基线及其后coalition补充均可恢复。

执行：2026-11-05T02:59:11.976Z clock0→03:29:16.686Z measurementEnd，1804.705777542秒。原7点齐、35正式+5预热真实nativeCLI全部完成，同5页面/WC/文档/表单状态保持。App72492实际normal0/null，harness无signals；两个采集器0/null，cleanupErrors为空。

结论：T111不能整条通过。原adjudication保持needs-analysis-or-partial，S02最后4个milestone RSS严格上涨红保留；其余8原判据绿。30/10比例1.0034939295720486，仍满足110%条件。15/20/25/30原RSS依次1492369408/1493925888/1494220800/1496399872B，合计+4030464B（3.84375MiB）。

RSS补充仅用已有原始数据：净增中主72492贡献2752512B（2.625MiB），renderer72621贡献868352B（0.828125MiB），其余18净额409600B。各PID出生/路径相同。主进程每批5CLI后即时增加约139.55/143.77/147.44/149.84MiB，之后记录到明显回落；最后15分钟有47次主RSS下降、48次合计下降。未采GC/保留对象，不宣称发生GC或泄漏；不把这些回落替换原四点红。详见rss-attribution.json/.md、rss-static-source-evidence.json；静态保留结构仅列事实，不能归因。下一最小诊断建议保持独立租约/无强制GC/不代替原30分钟。

CPU：原own闲时加权0.6726096932192769%单核，1767.093951042秒/355完整idle区间，无观测gap；最大原idle峰3.638011137345001%。这条曲线是已观测own值，不能单独作全范围通过。旧perPID max-own/reaped-child参考54.5868148333 CPU秒，旧scope-policy仍pending/旧judge保持不通过，未把策略文字自动改绿。

新增Kernel累计：20实际anchor在每capture均核UID501/出生/startAbstime/路径及resourceCID719。364 Native samples（另初始），14560 child-list attempts、14580参考rusage读（含20个init读）均有效。独立coalition的1837必经检查全绿，初始响应在Node clock0前、末次请求在measurementEnd后，原Native与Node各自monotonic窗口保留且不混跨域数值。wholeCID差1291.0156950416667 CPU秒 / 原idle分母 =73.05869018907538%单核上界，明确inconclusive。包括其它成员、忙时与采集成本；不扣基线、不滤其它成员、不把此值称App CPU产品红。原始cpu-rusage/coalition-usage/resource-samples流、完整CLI回执、所有分析及原曲线PNG/SVG保留。

资源已实际释放：原verify-cleanup在后续组启动前完成，64精确PID身份/13TCP/5Helper运行文件/准确gateway socket与目录/本App包进程五项全清；/private/tmp/wy-cli-501-rGBz1O/cli.sock与目录已缺席。之后没有新Native/OS诊断，只做文件静态整理。Root后续R004已占用Native，不重复global查询或误清其进程。

formalCaseCredit=0，公共账未改。manifest.json不含自身且排除缓存、运行时userData/凭据、Node依赖与真实App包，间接冻结依赖由prepared/preflight哈希关联。另行一页LaunchServices静态建议在/private/tmp/willyou-m12-p069-launchservices-note-008；未实现/未运行/不改本轮。
