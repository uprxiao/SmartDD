# F04 配置来源、优先级与外部修订验证

2026-11-14。F04 的研究合同关闭，现行决定合入[技术方案 §5.1.1](../../技术方案.md#511-现有来源的继承与确定性解析f04)。仅研究与合成证据，没有修改产品代码或真实登录配置。

## 13 项检查与结论

| 证据 | 检查 | 结论与边界 |
| --- | --- | --- |
| [Claude 实跑](claude-result.json) | 3 项 | env-only 负对照实际打到 local 文件配置端点；显式 settings.env 的路由覆盖成功，但内联对象含 Key 会进入 argv；最终改用首条输入前的 applyFlagSettings 控制通道，所选端点／令牌保持。项目 CLAUDE.md 到达模型，原生 default 模式未被文件 bypassPermissions 覆盖；strictMcpConfig 只启动显式 MCP。外部配置根模式读取 user→project→local 的实际来源 |
| [Codex 实跑](codex-result.json) | 3 项 | config/read 读取受信项目 model／sandbox；显式宿主 -c 覆盖 model／provider／approval／sandbox。重开原生进程读到修改后的项目配置，原合成 auth.json 未被改写；account/read 只证明本地凭据类型识别，没有真实账号认证 |
| [实际发现与修订候选](contract-result.json) | 6 项 | 当前 discovery 区分隐式与显式默认 Claude 根的 .claude.json；实际环境隔离／SVN 项目边界保留。候选发现同长度／还原 mtime 后内容变化、文件新建／移走、根替换和捕获中替换；超限拒绝，不扫描工程全树 |
| [目标与共同事务](target-result.json) | 1 项 | P1.2 Target 增加 configSourceHash；原 F01 事务代码将它冻结进 C1.2 submission。新命令使用旧来源被拒绝，原命令重放只返回旧收据，新选择可登记 |

Claude 五个 SDK worker／五个 native 正常退出（含两次定向凭据检查），五个已记录的 MCP PID 在事后审计均不存在；Codex 三个 app-server 正常退出。[进程核验](process-audit.json)保留边界。本机合成模型共八次请求，没有真实 API 调用；Codex 只查询配置／本地 account，不运行模型。

凭据定向检查保留了内联 settings 把合成 Key 放入 argv 的反例；[控制通道结果](claude-control-result.json)与[传输核验](credential-transport-audit.json)证明 applyFlagSettings 在首条输入前成功、实际 argv 不含所选 Key，扫描原生 HOME 也未发现所选合成 Key，原 settings 文件未改写。前后复验仍属 C02，不累加检查数。生产须保留这一发送门闩，失败不能放行输入。

权限结论以[精确工具结果](permission-audit.json)为据：模型尝试 Write，native 返回该工具已禁用，文件不存在、许可回调零次。不能用请求全文包含 denied／not allowed 的宽泛字符串字段当作证据，也不将 SDK managedSettings 夹具等同企业 MDM／policyHelper 实测。

## 既有业务与配置的实际边界

SmartDD 的 provider／login 先走 AgentRuntimeService／planAgentLaunch；legacy 才沿用 AiProfileService。当前受管 Claude 已是 user-only 设置来源、独立受管根、严格 MCP 和显式项目指令，不应因新实验启用所有来源而扩大产品默认。Codex 的 provider 模式已有显式 provider／模型目录及 native plugins 限制，也须保留。

T3 的 Claude 适配明确说明文件 settings.env 可覆盖进程 env，并使用 flag settings；SDK 端需要全局环境的读取／历史操作用 worker 隔离。固定 SDK 的 resolveSettings 类型说明其结果只是原始配置级联：省略 policyHelper 执行，project 的升级权限仍须另做 trust filter，settingSources=[] 仍会读 managed tier。此处为源码／本地类型证据，不宣称执行了真实 MDM 或远端组织策略。

外部根意味着明确选择的来源，不意味着任意 shell rc／配置字段都自动继承。合成文件环境已实测，真实订阅／OS Keychain、任意 auth helper、企业 policyHelper／云认证仍须在对应产品候选上验证；未验证组合诊断为 probe-required 并保留旧 CLI 入口，不自动切为另一账号。归档不含日常账号或凭据。

## 修订与协议

源清单包含来源模式、显式性、profile 执行修订、根物理身份、有限文件列表、缺失状态及应用私有 HMAC 内容指纹；HMAC 密钥只在实验内存，不归档。候选上限为 128 个来源、每个 1 MiB、总计 8 MiB，64 KiB 分块读取；超限报错，不截断后声称完整。实际只读样本为一份小配置，不能称公司项目性能测试。

P1.2 [协议形状](contract.mjs)仅比 P1.1 增加 configSourceHash；[来源读取候选](revision.mjs)不替代正式业务锁、平台 watcher 或配置解析器。C1.2 的 JSON target 已能保存新字段，SQL 表未改；配置根变化不能仅依靠数据库 profile revision。委派测试的授权、当前来源、已停止父 run 是显式夹具，不证明真实子启动；实际 fork／Key 变化复用 §4.42–43，实际 Agent／Provider 修订复用 §4.110。

## 保留的修正与未执行项

构建最初缺 semver／smol-toml／yaml，使用既有隔离依赖后成功，未安装或改产品依赖。source revision 初版误把 resolve 直接传给 map，导致实参类型错误；随后目录 rename 先触发 ctime 复核，测试原先只接受后续路径替换错误，修正为接受任一明确拒绝，未放宽实现。两个失败批次及最终六项结果保留；不累加为更多通过项。

没有运行正式 UI、Keychain、真实服务认证、全平台文件事件或最终 exec 原子性实验。文件检查不是对可变外部目录的 OS 锁；路由／模型／权限须由已冻结显式参数控制，来源变化在准备、发布、派发、恢复及下一回合复核，不承诺任意时刻编辑外部配置都被同步发现。新任务／切换的实际入口、配置提示和保留业务回归由开发后 A06／07／12／14／20／54 验收。F02 通用接入、F05 MCP 复杂协议、F08 业务准入与 F10 资源生命周期继续各自处理。

## 归档

[完整证据](evidence.tar.gz)、[清单](archive-manifest.json)、[摘要](archive-summary.json)含原脚本、合成配置与结果、当前源码 bundle 及 131 个输入摘要、协议夹具和合成数据库。原生二进制／用户数据／真实 Key 不入包。绝对路径记录原执行环境；跨机复现需配置固定依赖及先核摘要。归档只做文件完整性与结果复核，不重复 native 调用。
