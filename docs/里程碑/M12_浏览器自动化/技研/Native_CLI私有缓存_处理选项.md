# Native CLI 私有缓存处理选项

状态：最小本机技术对照已完成，用户已明确选择仅受管运行关闭快照（call_f99a728810f84864add1a486866164c6/0）；现行规则已合入需求R1.6、技术方案V1.5，本机arm64生产修复、安装、实际Host机制及真实业务恢复／停止回归已完成；其他平台与剩余M12验收取原账。关联发现`M12-NATIVE-CACHE-01`，本文件不作为正式用例通过证据。

原发现和证据见[冻结核查](../验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P108/native-token-cache-boundary-001/manifest.json)。真实Codex0.166.0曾将本次运行授权串写入自己的shell快照；这不是禅道、邮件或OpenAI账号密钥。外层0700限制不同系统用户访问，同UID仍可读取。停止后宿主撤销授权与磁盘副本是否保留是两项独立保证，不能混写；既有停止后旧身份拒绝证据不证明缓存被删除。

2026-11-06重新读取官方说明：[安全配置说明](https://learn.chatgpt.com/docs/enterprise/security-cookbook#minimize-the-shell-environment)将环境过滤列为可配置默认，并明确shell初始化/快照等来源仍可能带入凭据；[环境策略](https://learn.chatgpt.com/docs/config-file/config-advanced#shell-environment-policy)的过滤对象是实际子命令环境。它们不建立独立“仅快照排除某个变量”的支持证据。原精确0.166.0源码审查仍按冻结记录保留，当前在线文档不替代已安装binary行为验证。

| 处理选项 | 预期影响 | 所需决定与验证 |
| --- | --- | --- |
| 保持现有shell能力，明确私有缓存限制 | 延续现有令牌加进程身份校验；运行授权串仍可能进入Native私有快照 | 用户确认接受这项具体留存限制；纠正gateway跨组件“绝不落盘”注释，不改写原隐私红或宣称已清除缓存 |
| 在有受管CLI身份的Codex运行中关闭shell快照 | 使用官方已有shell_snapshot开关，shell初始化/环境复用行为发生变化；实际子命令仍须拿到运行身份 | 先以合成值做on/off本机对照；用户同意作用范围后才接入适配器，补真实CLI、并发/恢复/停止及相关缓存验证；不改全局用户配置 |
| 只过滤快照中的指定变量 | 目标是保留实际子命令环境和现有shell能力 | 当前没有已证实的受支持开关；须上游能力或版本化适配及额外技研，不把普通exclude/set或网络凭据broker当作已经可用的替代 |

接下来的最小本机对照只使用合成变量和本机合成服务，分别在独立HOME/CODEX_HOME启动同一固定CLI，观察真实子命令变量可用性、运行中快照落盘和正常退出后的状态。必须先取得on阳性才能解释off；不读取实际授权值或登录，不发送至真实模型，不修改产品或用户配置。结果仅支撑处理选项，不能替代Host鉴权、真实模型R或原121条验收。

2026-11-06 本机对照已执行，见[固定输入、结果及独立清场](../验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P108/native-cache-toggle-control-001/manifest.json)。同一已安装 Codex 0.166.0、两个新建私有 HOME/CODEX_HOME、本机合成 Responses 服务；每组只执行一次环境存在性命令，不读取真实认证、不连接外部模型。

- 显式开启 `shell_snapshot`：真实子命令变量可用、退出码 0；CLI 仍活跃时，快照文件命中合成标记 1 次。
- 显式关闭：真实子命令变量仍可用、退出码 0；同样活跃阶段扫描命中 0 次。
- 两组均正常 EOF 退出、无信号、独立 8 项清场通过。本次 app-server 正常退出后，两组扫描均为 0；这不能推翻此前真实 TUI 停止后仍留存的结果，两者生命周期不同。

该结果证明固定版本开关对本地快照的影响，支持继续准备“仅受管 Codex 运行关闭快照”的实现选项；尚未证明 WillYou 适配、真实模型、恢复／并发／停止、性能或其他 Native 文件均无泄漏，不据此关闭原发现。用户决定前的本机对照未改变生产配置。后续按已确认方案修复；未代用户接受留存限制。


2026-11-06 当前App025工程补证：[实际Host I003](../验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P129/actual-Host-cache-I003/manifest.json)、[Root限定复核](../验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P129/current-App025-coordinator-001/manifest.json)。生产Host确实以最后的关闭参数启动固定CLI，原生身份在同run/task被实际接受；活跃期扫描本次新私有CODEX_HOME的77文件、3,775,800字节，raw/base64/UTF16LE无命中、无扫描错误。一条实际identity命令child0。原90秒超时来自仅识别event_msg/user_message的观察器；离线原严格canonical读取恢复一次完整150B user ACK及一call/output/completion，原4/7判定保留。实际停止及只读完整DB行stopped/revoked有证据，但没有保存停止后tokenMap／AbortSignal观察，不能由DB补写内存结论。未连接真实OpenAI或复制认证；这层I不代替真实业务R／恢复，也不删除或证明历史缓存消失。


2026-11-06 I004独立实际停止补证：[完整可恢复输入／原始安全数据／Root复核](../验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P129/actual-Host-cache-I004/manifest.json)。原I003的缺项与4/7历史判定保持；本次新执行修正严格canonical reader，只做一条真实readonly identity，本机合成provider，未读取认证或连接真实OpenAI。issue正常delegate后捕获原OwnedRun、其Signal及Gateway Map原引用；停止前后引用恒等均实测true，精确绑定由有到无、该run绑定数1→0、同Signal.aborted false→true，DB同run stopped/revoked。每份原始snapshot先落盘再独立判定，不从DB推断内存事实。活跃Native新私有CODEX_HOME扫描77文件／3,775,800B零命中、无错误；原judge7/7，App正常0/null/无signal，21项准确资源全清。测试观察器为匹配仍持有原值，随后记录已清；本结论是授权绑定回收，不能描述为进程堆值清零或历史缓存清除。真实恢复另见已接受T125，原沙箱、审批与全局配置保持。
