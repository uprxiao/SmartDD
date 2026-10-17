# Codex 多应用扩展契约 REA V2

2026-10-17。依据：[M10 需求 R1.3-20261017](../需求.md)，对应 M10-R01／R02／R07／R08／R09，并为 P01／P03／P04／P08 提供扩展来源；承接依据 R1.2 的[接入生命周期 V1](Codex接入生命周期REA_V1.md)和[接入后使用链路 V1](Codex接入后使用链路REA_V1.md)，不改写 V1 历史。应用入口、独立连接配置、项目按需选用、工具调用及可选 Skill 的组织方式已认可，用户授权继续 REA、原型和技研，希望后续 Jenkins 及更多应用能复用。本稿只追加扩展契约研究，不改变本期禅道＋邮件范围，不纳入 Jenkins 实现，不构成生产开发批准。

结论：**公共框架可以统一注册、配置、连接状态、权限执行、调用与记录；每个应用的数据及业务动作仍由各自适配器实现。** Codex 的插件是组件与入口的组织方式，MCP server 的工具和 handler 才实际执行业务。新增一个目录卡或一份 manifest，不会自动获得 Jenkins、禅道或 Foxmail 的读取和操作能力。

## 1. 增量证据及适用边界

本机标的继续固定为 bundle `com.openai.codex`、版本 `26.1007.30912`、build `20156`。ASAR：`/Applications/ChatGPT.app/Contents/Resources/app.asar`，SHA-256 `75e397e2280dde93b70a85aa926f4282c728eacc84dfeb15ba7fb6ddd84628af`。

本轮没有重跑 V1 的 18 模块。仅对 6 个新成员做一次 REA，读取 **37,856 bytes，6 个解析成功、0 个失败**；应用与语义图 partial，本轮没有节点上限截断。另对共享大文件的新相关函数作手工惰性 AST 定位，不据此宣称整个共享模块已进入 REA 图。

| 证据 | 标识／范围 |
| --- | --- |
| REA 父记录 | `ev_007404283529ac4e9890c946c47568524ec6ae3ad72351ae60f638c31960f0ea` |
| REA 摘要 | `ev_5319f39fcf6c9be5781670cfe1a8287b38cc041d39e7d132010e3403984e5283` |
| 新解析成员 | `plugin-settings-section`、`find-plugin-mcp-extension-view`、结构化设置 `page-2c23...`、`category-plugins-query`、`plugins-page-selectors`、`plugin-share-version` |
| 人工补充 | `app-shared` 中发布组件标准化、详情合并、版本门控及 MCP App 工具解析的相关函数 |
| 定位索引 | [7 成员、25 处源码锚点及官方来源哈希](证据/codex-extension-v2-locations.json)；原始行／列、字节范围及成员／片段 SHA-256 |
| 官方资料 | 使用 OpenAI Docs **先搜索、再 fetch** 的 4 份实际正文；来源 D01–D04 列于下节 |

7 个使用到的成员均与原 ASAR 按绝对偏移逐字节重新核对。REA 的 `record-and-continue` 仍报告 V1 已记录的 7 个 unpacked 原生成员完整性矛盾，原因未确定；不得把本轮 JS 字节一致写成矛盾已消除。16,234 个未选文件、原生 app-server 的包解析器、真实注册／安装和所有账号连接均未执行。

静态补查与官方原文保存在忽略目录 `release/m10-research/extension-v2/`；入库只放报告和元信息。V1 原文、公共入口、阶段需求、主方案及原型均未在本专项修改。

## 2. 官方插件契约：声明、工具与认证分别放在哪里

2026-10-17 抓取的官方文档与固定安装版本是两种证据。以下说明当前公开契约，**不表示 26.1007.30912 已实现文档中全部新格式或全部分发方式**。

| 层 | 官方契约的关键点 | 本项目应借鉴的职责 |
| --- | --- | --- |
| 包身份／组件 | 当前推荐 portable 根 `plugin.json`；根 `skills/` 和 `mcp.json` 约定组件；OpenAI 专属设置放 `extensions.com.openai`。兼容 `.codex-plugin/plugin.json` 仍支持，inline extension 与兼容 overlay 不合并 [D01、D04] | 稳定 provider ID、实现版本和组件声明，与显示名称分开 |
| 目录注册 | marketplace 可以登记多个插件，声明来源与安装／认证策略；本地、项目、公共目录是不同分发入口 [D01] | 一个注册表管理多种应用；不需要每个应用另造连接管理系统 |
| 能力实现 | MCP server 注册独立动作，工具含名称、描述、输入／输出 schema、annotations 和 handler；handler 执行业务及授权 [D02] | 统一能力描述和调用契约，各适配器实现接口 |
| 认证 | portable `mcp.json` 每个 server 的 OpenAI 扩展声明认证方式；manifest 只放连接信息，不放秘密；认证流程和 UI 属于相应 MCP 集成 [D01] | 认证描述、凭据引用、授权流程与连接实例分开 |
| 安装后配置 | plugin 启停、server 启停、工具许可和认证是不同状态；禁用不等于卸载或撤销服务认证 [D01] | 共用生命周期，但分别保存、核对和展示状态 |
| 包校验／更新 | 包校验、公开目录校验和 review 有不同要求，版本／组件路径／名称及声明均需验证；成功上传不等于功能通过 [D03、D04] | 注册前校验、兼容性与版本记录；不要把“加载了定义”显示为“业务已接通” |

D01：[Package your plugin](https://developers.openai.com/plugins/build/plugins)。D02：[Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)。D03：[Plugin submission errors](https://developers.openai.com/plugins/deploy/submission-errors)。D04：[Manifest fields](https://developers.openai.com/plugins/deploy/submission#manifest-fields)。这些当前正文均已 fetch，并在证据 JSON 记录哈希；没有只依赖搜索摘要。

对 WillYou，是否支持第三方安装包、portable manifest、公共目录或兼容 Codex 包格式，仍是独立产品范围。M10 可以先用内置可信 provider 注册表达成多应用复用；**通用框架不要求这一期交付开放插件市场**。公司内网应用与本机 Foxmail 也不因 OpenAI 公共目录的审查要求就必须暴露到公网。

## 3. 固定发布包实际消费的插件信息

人工核对共享模块的 H2／pQr／eQr／aQr，能看到远端 release 被转成公共详情数据：稳定插件 ID／remotePluginId、显示元数据、version、来源、authPolicy、installPolicy、enabled／installed、关联 app IDs、MCP server keys、Skill、onboarding 等各自保留。[X14–X18]

本地／远端插件读取经过同一详情组合层，目录查询再将远端类别列表和已安装条目对应起来，以 remotePluginId 或 id 去重。这支持“多种来源共用展示和生命周期”，但不能据此推断插件后端没有应用专用代码，或每种服务都只有通用 HTTP 请求。[X01、X14–X18]

发布包中的 `app_manifest.apps` 逻辑项对应注册 app ID；MCP server 名称、Skill 和关联 app 不被压成一种资源。详情合并时，仅在相应分支或本地 summary.version 与远端 release.version 一致时采用指定 app-manifest 对应关系。这是一个具体的**版本一致性门控**，不是已证明的完整 semver 协商或热升级协议。[X15、X16、X18]

当前公开文档里的 portable 根 manifest、兼容 overlay 和市场格式，比发布包 UI 消费到的标准化 release 更靠前。本轮没有反编译 native app-server 的 manifest 解析器，故以下问题保留 unknown：该构建支持哪些 portable schema 版本、发现优先级与路径规则如何实际执行、同名 server 的加载冲突如何处理、升级时是否原子回滚。不能用 UI 出现了 version 字段代替这些证明。

## 4. 可扩展配置不是任意 manifest 自动生效

本轮找到一条独立于初次认证的配置扩展路线：插件关联 MCP settings view；通用页面调用 readTool 获取设置定义／有效值，按受支持 schema 渲染，再通过 updateTool 更新后重新读取。[X03–X11]

```text
已安装插件
  → 按 plugin / connector / server 找到关联 settings view
  → readTool → { schema, values, layout 等 }
  → 通用设置页：字段／布局／校验／loading／error／read-only
  → updateTool({ set: { <property>: <value> } })
  → 解析结果＋重新读取有效设置
```

已证实的粒度：

| 部分 | 本版静态观察 | 迁移到 WillYou 时的边界 |
| --- | --- | --- |
| 视图归属 | 按 remote plugin ID、关联 connector app、pluginId 或归一化 server 名绑定；不是按显示名任意串联 [X03、X04] | 使用稳定 provider／connection／capability ID，显示搜索不能充当授权身份 |
| 简单字段 | boolean、string、number、integer；string enum；长度／pattern／数值区间／multipleOf 校验 [X07、X11] | 首版 schema 需明确支持子集；复杂表单单独设计 |
| 复杂 schema | `$ref`／anyOf／oneOf／allOf 在此设置子集声明为可缺省的 never；已追到导出绑定及 ZodNever 构造 [X07、X23–X25] | 不得宣称支持任意 JSON Schema、嵌套对象或所有协议关键词 |
| 布局 | 可按布局分组，未列出的属性可作为其余字段显示 [X08] | 公共连接字段可复用，应用专用配置通过受控扩展 |
| 数据与身份 | query key 包含 account／user、link、host、server、readTool、toolScope；当前身份变化时拒绝 [X09] | 缓存必须隔离实例、账号与有效权限版本 |
| 写入后核实 | 提交 set、检查 isError 与响应 shape；finally 再读取服务端有效值 [X10] | 区分保存成功、刷新失败与实际有效配置；不能仅凭本地表单值宣告成功 |
| 缺失能力 | 找不到 updateTool 时显示只读；有 loading、读／写错误、重试与 pending 禁用 [X09] | 适配器只实现读取也能接入，但 UI 必须准确表达能力 |
| 传输 | 设置工具调用区分 app-server 与 hosted transport；前者先经过可信 toolScope 解析 [X06] | 通用调用接口可以承载不同执行通道，不能绕过 broker 的身份和策略校验 |

这是发布包的一条设置扩展链；不等于所有 provider 初次连接字段都由同一 schema 自动生成，也没有证明 hosted 分支在当前桌面可达。V1 对相应 feature-off 分支的限制继续有效。官方文档同时要求各工具 handler 执行授权，schema 和 annotations 都不能替代后端约束。[D02]

## 5. 多应用的工具名字、账号与权限不能混在一起

MCP App 设置调用借助共享 Mhn／Nhn／Ihn／jhn：对 `codex_apps` 工具先按 connector 或 target scope 过滤；先匹配资源身份／工具名，标题或 actionName 回退只有唯一候选才接受；超出可信范围或缺少所需 scope 会拒绝。target identity 包含 connectorId、kind 和 targetId。[X06、X19–X22]

这一证据只适用于 **MCP App／设置视图路径**；不能推广为所有 Agent 工具注册的全局同名解决方案。对普通 server 分支，本轮没有发现／证明全局注册器的同名拒绝、自动改名、长度上限或冲突优先级。目录选择器中的文字归一化只是显示／搜索匹配，不是凭据身份。[X02]

插件工具详情将带 READ badge 的动作分到读取组，其余分到写入组。该页面分组有助于理解能力，不证明服务端已经据 badge 强制授权；同样，插件的展示 capabilities 文案不能作为准确的可调用工具清单。[X12、D02]

WillYou 的建议是保存三个不同身份：

| 身份 | 作用 | 示例性质 |
| --- | --- | --- |
| providerId | 应用／适配器类型，参与工具命名空间 | 禅道、邮件本地来源、邮件发送、未来 Jenkins；本项目候选 |
| capabilityId／contractVersion | 稳定动作及输入输出契约 | 列表、详情、发送、流转等；不按显示名称分派 |
| connectionId | 某个真实服务端／账号实例，决定凭据与数据边界 | 同一 provider 可以对应不同公司实例或账号 |

对外工具名由 broker 按实际 Agent 客户端允许的规则生成；内部保留上述完整身份。注册时检测原名、规范化后名字与已有工具的冲突，遇歧义明确报错；调用参数不能随意替换成其他 connection。**这部分是 WillYou 设计候选，不是 Codex 全局注册器已被反编译证明的行为。** CLI／MCP 的真实命名兼容和 schema 大小继续用隔离实验核实。

## 6. 通用生命周期如何容纳独立业务适配

建议把扩展点收敛为下列候选契约。它描述职责，不是本轮已经实现的源码接口；具体命名由正式技术方案统一。

| 契约 | 公共层负责 | provider 必须提供 |
| --- | --- | --- |
| 定义注册 | 校验 ID／版本／schema、注册表、卡片／表单入口 | 应用元数据、配置 schema、支持认证、实际能力与平台边界 |
| 创建连接 | 公共状态、加密凭据引用、连接实例和操作记录 | 参数校验、认证／来源初始化、当前账号／来源身份探测 |
| 读取能力 | 统一 discover／调用／结果 envelope | 对本实例实际可用能力和限制；不能只返回静态宣传标签 |
| 执行能力 | 参数 schema、项目／任务身份、策略、超时取消、审计 | API／本地格式实现、服务端权限、数据映射与业务前置条件 |
| 恢复／核实 | 公共 pending、失败、结果未知及重试入口 | 认证恢复、结果核实与安全重试方式；不支持幂等时明确说明 |
| 停用／清理 | 阻止新调用、历史关联、任务恢复检查 | 释放本地资源；远端撤权、缓存删除支持程度及各自结果 |
| 升级 | adapter／config schema／能力契约版本和迁移记录 | 兼容变更、迁移、不可兼容项与必要复验 |

候选挂接顺序为：**注册定义→验证连接→实际探测→公布可用能力→broker 按范围过滤→向 UI／Agent／后续 M11 暴露→执行并核实结果**。页面和调度复用同一个 broker；provider 适配器不各自创造一套账号管理、任务授权和执行记录。

可以先实现固定应用内置注册表并随 WillYou 版本交付。将来若引入第三方包安装，再增加来源与完整性、依赖、版本锁定、安装／卸载、运行隔离和兼容测试；这些与“新增一个 Jenkins provider”并不是同一工作量，不应因本次复用设计而隐含扩大 M10。

## 7. 禅道、邮件、Jenkins 的复用与专用部分

| 方向 | 可直接复用的框架职责 | 仍须针对业务单做 |
| --- | --- | --- |
| 禅道 | 配置／实例／凭据、状态、目录、Agent 调用、调用记录、失败恢复 | biz13.0 的认证、本人 Bug／Story 语义、正文附件／历史、对象状态及每个获准流转动作；沿用专项研究边界 |
| Foxmail 读取 | 来源配置、验证状态、分页／能力 envelope、只读调用与缓存隔离 | 本机存储版本、索引与正文／附件映射、账号归属、增量和锁定；云邮箱 OAuth 不能补回仅本地存在的历史 |
| 邮件发送 | capability schema、账号选择、准备／确认／执行／核实／记录 | 实际发送通道、回复关系、附件、草稿和发件回执；不得把 Foxmail 读取连接自动当成可发件账号 |
| Jenkins（未来） | 同一个 provider 注册表、连接向导、身份／能力／策略／结果层、Agent／M11 调用通道 | 部署版本与认证、服务端权限、业务对象及用户希望开放哪些读取／执行动作；触发后核实和取消／恢复语义需另调研 |
| 更多应用 | 元数据、简单配置、生命周期和稳定工具注册方式 | 真实服务协议、资源身份、能力字段、权限、业务动作、平台依赖与契约测试 |

因此，未来 Jenkins 接入应新增 provider 定义、配置／认证实现、能力 handler、数据映射和测试；公共连接页面主要呈现该定义与状态，公共 broker 沿用调用契约。若 Jenkins 要有专用结果页或复杂业务表单，再新增受控展示扩展。**没有承诺“填一个 URL 就自动支持全部业务”。** 本轮没有连接或核查 Jenkins，也不据示例指定其版本／API／可执行动作。

## 8. 版本与兼容的候选验收约束

版本至少分开记录：WillYou 应用版本、provider 实现版本、连接配置 schema 修订、capability 契约修订，以及已探测的外部服务版本。Codex 的 release version 门控提供了具体参考，但不是我们可以直接照搬的完整迁移机制。[X16]

不依赖用户业务取舍的技术用例候选如下，均**未在本轮执行**：

1. 两种 provider 同时注册，目录／表单／调用记录走同一层；一个失效不影响另一个。
2. 同一 provider 两个 connection 的数据、秘密、缓存和授权不串用；切换项目或账号后拒绝旧请求。
3. 工具原名或规范化后名字冲突时，注册报出可定位错误，不能静默覆盖。
4. 无 update／write 能力时只读展示；启用 provider 不自动授予发送或流转能力。
5. 配置 schema 升级具有迁移和失败恢复，重启后保持；迁移失败不以空配置覆盖旧值。
6. 已运行任务遇 provider／能力版本变化时重新校验；不把旧 schema 的参数静默解释成新动作。
7. provider 停用后阻止新调用，历史结果仍可追溯；断开、删除配置和撤销远端认证分别记录。
8. 错误、取消、超时与结果未知有明确 envelope；适配器不支持安全重试时，broker 不盲目重发。

写入／发送的具体审批策略、数据保存期限、账号数量及更细的项目能力范围、首版平台仍交业务评审决定；已认可的统一连接管理与项目按需选用继续沿用，上述框架约束不替用户决定其余规则。

## 9. 已回答、部分回答与未知

| 原问题 | 当前结论 | 剩余证据 |
| --- | --- | --- |
| 新应用如何声明／注册 | 官方包／市场契约已实际读取；固定包的标准化 release／组件关系已定位 | 固定构建 native 包解析器与实际注册未测 |
| 配置是否可通用 | 已找到 primitive schema 的 read/update 设置扩展及状态 | 初次连接字段／复杂配置是否同一机制不能概括；需 WillYou 契约实验 |
| 业务实现怎样挂接 | 官方 tools＋handler 和本机 transport／view 绑定支持明确分层 | 每个真实 provider 必须独立验证协议与业务 |
| 名称、权限和账号边界 | MCP App scoped resolver 已补证，连接与启停沿用 V1 | 全局工具注册碰撞规则及后端权限执行仍未知 |
| 版本与兼容 | 发现具体版本门控，官方有版本／组件规范 | 热升级／完整迁移／回滚及固定版本 portable 支持未证明 |
| Jenkins 能否沿用 | 连接、配置、能力调用与记录层可作为本项目共同设计 | Jenkins 具体接入另做专项，不进入 M10 本期开发 |

本 V2 为新应用扩展预留了可讨论的技术契约，并标明通用层和业务层的分工。未安装插件、调用真实连接、读取账号秘密或更改 Codex。REA 静态与官方当前文档、WillYou 建议、后续真实验收分别记录，不将它们混写为已经接通。
