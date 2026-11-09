# 006 生产范围复核与原 long004 门槛建议

本次仅静态/纯数据；没有 App/OS/采样/Native。005 原92文件逐SHA核同，原judge/result/policy保留。source-evidence.json 保存实际 source023、固定6b77复制源、实际005外部驱动的路径、完整SHA及关键源码行；actual-005-topology-checks.json 独立重算原始树与读序。没有把policy字符串改verified。

## 已修复的测试工具缺陷

cpu_judge_v2 把全部必经checks共同作为decision和scopeApproved硬gate；独立核全部已捕获API尝试，并从节点真实first/last rusage重建每birth max信用，不能只信credits和advertised sum互相一致。原idle分母须为有限正数、≤实际测期，正式测期≥1800秒。18项纯数据负控通过；旧judge出现候选绿/错误scopeApproved的实际合成载体与原输出完整保留（明确synthetic，非生产证据）。

collector_v2 对任何list errno非0（包括ret0）失败关闭；保留InventoryError原attempts，before/after末读错误入gap；成功init新增initialReads。005原raw独立重判：240次child-list尝试和240次node rusage读全部有效/errno0，raw信用精确重建一致；唯一未满足的原check仍是scope前提。旧init没有initialReads，不能补造其原始errno，修订明确这个历史载体边界。

## 五项前提逐项判定

### 1. owned baseline inventory

实际20 anchors由主App＋真实Electron metrics＋5个receiver-ready真实PID＋5页私有Helper PID并集得到，恰等于旧psutil同时观察到的20进程。角色为App1/electron9/receiver5/fixed-daemon5。6次Native扫描所有PID/startAbstime/path持续一致，均exitAbstime0；5daemon所有first/last的真实PPID均1。最终14个parent-child边的child末读均早于parent末读。

结论：005这个受控实例的已知基线树和持有身份已证；不能拿旧20个PID代替新长测，也不把端点一致推导为没有所有未观测短进程。长测必须重新建立清单、在每样本检查，任何missing/change/API错误失败关闭。

### 2. 短子进程通过持有root回收

允许输入在receiver.py被限定为P069 SAMPLE warm/0/5/10/15/20/25/30；其唯一路径Popen真willyou-app snapshot并communicate回收。原生cli.mm不启动子进程。App MacUnixPeerIdentityReader等待其身份helper close再完成认证；MacProcessIdentityReader用execFileSync；BrowserHelper用execFile batch并等待原回调。原生process-identity.cc仅查内核身份/对端，不fork子树。5个receiver不运行模型/任意脚本，不发其它应用命令。

002已真实证明own/child的Mach单位、真正wait后计入、两级回收一次归并；004证明unreaped列出以及scan后已reap项目的后置parent累计。005实际App child和5 receiver child累计均增长，证明真实进程路径已接，不只是C模型。

结论：上述选定正常spawn/wait路径有源码和实际累计证据；这不是按PID采样“看见了全部短命叶子”。隐藏但已回收的leaf由持有root child累计覆盖；未回收的leaf靠完整子项枚举/真实rusage，不能把它当0。对其它动态路径或来源不明的终止项不能外推。

### 3. 固定6b的额外orphan / bootstrap

实际外部argv固定batch＋本页CDP，snapshot→AX/CDP读取；指定CDP的BrowserManager将browser_process=None，不调用launch_chrome。install/upgrade/provider/recording/dashboard等OS-spawn入口不是该argv可达分支；tokio::spawn是同进程任务，不当OS子进程。

真正detached机制是connection.rs的ensure_daemon：ready且同版本立即复用，否则先cleanup_stale_files，再setsid/spawn本binary。run_daemon启动就写新PID、删除原socket再bind，退出删除PID/socket；没有恢复旧PID文件的正常路径。version mismatch还会杀旧daemon。结合本次每页唯一PID文件、固定5个原生出生身份保持且10条CLI均成功，支持这次所选成功路径没有替换/重启daemon；失败/换代不能被默许继续。

结论：已给出固定6b/受控snapshot输入下的有界启动闭包推理；不是系统级“绝无额外orphan”观测。**尚不能用这些源码和6次树扫描证明任意Electron/Chromium内部或外部同UID行为不会产生完全未观测的detached进程**。本次没有触发新页面/导航/模型/其它应用/外部网站，全部fixture静态无timer/polling，基线renderer/utility保持；这缩小了实际风险，但仍需协调者明确本测试允许采用的受控进程闭包，而不是简单改policy。

如出现无法解释的新root/reparent、额外Helper文件、CLI失败/timeout/reconnect或API读缺项，本条不成立，完整CPU结果incomplete。若协调者要求系统级未观测orphan排除，目前证据不足，不能用上界sum增长补造；也不建议因此重复005或放宽5%。

### 4. final cut 与扫描竞态

final请求在原measurementEnded之后的原Driver顺序中发出；Native finalCutBeforeScanNs等于扫描开始，所有节点first/last读都在cut之后。最后只有20个持有节点，没有额外live或unreaped节点；每个family before/after集合相同，240个列表尝试与240个rusage读无错误。14条子末读→父末读序全部真实满足。

覆盖论证（以无未计orphan为前提）：cut前消耗CPU的leaf若在scan前已wait，后置root child已计入；若仍活/未reap，真实完整inventory和rusage保留其信用；若在scan后被wait，后置parent累计补入；cut后新出生的leaf无需覆盖cut前CPU，即使收费也是过计。观察到的信用从不因回收扣除，parent rollup可重复收费。因此在这个闭包内整个生命周期upper覆盖实际idle CPU，不需要精确去重，也无需修改idle分母/峰值。

结论：005 final的实际读取/顺序已证；任意missing不能直接称已wait，修订后的工具将错误硬拒绝。长测需重做同一最终cut，若有未闭合race不能自动绿。本条不能消除第3项的未知orphan前提。

### 5. 原窗口/分母/全时长

原receiver、psutil、analyze、check、plot、verify-cleanup六脚本逐字相同。正式long分支仍1800秒、0/5/10/15/20/25/30分钟、35正式＋5warm、原5秒采样/全部峰值/原RSS与<5%一核；rusage新增流，分子收费启动/warm/busy/重复项，不改原idleEligibleSeconds。修订judge以原分析器文件为分母来源，并强校验有效性和实际≥1800秒。

结论：实现约束与原合同一致已证；005只是约10秒短预检，不能证明未来30分钟稳定/分母有效。完整这些事实必须由long真实执行产生。短own0.622261%只作信息，不给原用例绿。

## 建议的可执行 long 门槛

1. 使用已装入long004的防御collector/judge（新SHA在ready.json），原六脚本、App019/source023保持。无产品输入变化，无需新App/重build/重跑005。
2. 协调者先复核上述第3项有界闭包是否足以支撑本受控测试；不将其扩大为任意Electron活动的全局保证。没有接受该前提则长测即使upper<5仍只能incomplete，可将本次运行定位为原性能/趋势测量，不能承诺整条收口。
3. 长测起点API/持有身份gate必须真实通过；过程中任何身份/原始API/计数异常保留并阻止候选通过，不将ret0错误当空表、不用scope字符串压过红check。
4. 实测完原1800s/35+5后，原analyze不改地运行，再用cpu_judge.py <root> --output-dir <root>；所有必经checks均通过、原I/RSS/趋势通过、实际范围闭包被独立复核、保守upper严格<5后，才可由协调者正式归账。Upper>=5只是过计上界不足证明，原observed own>5则仍确定红。

这是允许执行路径和判定门槛建议，不是已经通过T111或已经授予Native租约；本次未安排任何新Native。
