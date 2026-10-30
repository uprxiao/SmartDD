# Codex 接入生命周期 REA V1

2026-10-17。依据：[M10 需求 R1.2-20261017](../需求.md)，对应 M10-R01／R02／R07／R08。范围为**目录→详情→安装→账号连接／认证→启停／重连／断开／卸载**及原型状态准备。本文是发布包静态调研，不是 Codex 运行验收或 WillYou 已确认设计；会话内工具发现与使用由同阶段专项报告承接。

可迁移的核心是：把应用定义、安装状态、连接实例、权限／就绪状态和执行结果分别管理；应用目录、账号认证、Agent 工具接入是关联的几层。Codex 发布包中同时存在本地 app-server 和远端服务分支，不能把所有接入都归为本地 MCP，也不能把云连接器等同于本机数据读取。

## 1. 标的、证据和覆盖

标的 `/Applications/ChatGPT.app/Contents/Resources/app.asar`；bundle `com.openai.codex`，版本 `26.1007.30912`，build `20156`。ASAR SHA-256 为 `75e397e2280dde93b70a85aa926f4282c728eacc84dfeb15ba7fb6ddd84628af`。安装目录名不是产品身份判断依据。

本轮复用既有提取目录，但对本文全部 23 个成员重新核对 SHA-256，并从原 ASAR 的绝对偏移读回逐字节比较，全部一致。选定 18 个 JS 成员进行一次 REA 分析，读取 419,035 bytes；18 个解析成功、0 个失败。补充手工静态分析只读取 `app-initial`、`app-shared`、主进程 main、共享 CSS 和连接骨架的相关片段，没有启动目标代码或解析 `app-initial` 全应用关系图。

| 证据 | ID／定位 | 用途及限制 |
| --- | --- | --- |
| REA 主分析 | `ev_c7d31e2320f6833694722a2d05893deacf9b0ad7ba5e4c57d97dd6f4ae895c78` | 18 个精确成员，16,222 个未选文件；应用图 partial |
| REA 摘要 | `ev_a1c5784a79e3bfb7078b7b34e7924389c0719c5ad5ca16270c4a0f07a680a760` | 语义图达到每文件 10,000／总计 80,000 节点上限，partial 且 truncated；不声明完整调用图 |
| 模块追踪 | `ev_e67c9dfc558c494a698dd8335c85a1c834f9e27ec7b8b306c9169e9263b248dc` | 精确 `use-app-connect-flow` 模块种子；因共用依赖触及完整库存节点，仍只有原来的 18 个源码被解析。结果超过 MCP 10 MiB 传输限制；已导出完整保留记录，未重复跑分析 |
| 有界负结果 | `ev_4db9ba5dd1f2440cc19f437bed3d955cd0aa1f5911330760c15c1d0783447c10` | 精确 MFA URL 字面种子未在 partial 图匹配；随后人工核对源码。该负结果不能证明功能不存在 |
| 人工定位 | [C01–C43 元信息](证据/codex-connection-v1-locations.json) | 原文件行号、UTF-16 列、半开字节范围、片段／成员哈希、ASAR 偏移；每处明确是否属于 REA 18 成员范围 |

工具按 `record-and-continue` 保留 7 个 unpacked 原生成员完整性矛盾，原因未确定；这些成员不属于 18 个选定 JS。不能据本轮字节核对消除该矛盾，也没有验证原生模块、签名或运行时可信状态。模块追踪所列 native handoff 是图候选，未打开原生分析器，不代表该连接流程实际加载了它们。

原始 REA bundle、AST 定位工具和专有代码片段仅保存在忽略目录 `release/m10-research/connection-v1/`。入库仅本文与哈希／位置元信息，不复制原始应用实现。完整 bundle 含 4 条记录，约 561 MB，当前只作为本机复核材料，不是产品依赖或交付资产。

## 2. 对初轮结论的补充和勘误

1. `apps-query-6b7fde21fbea.js` 的推荐／workspace／public 目录访问 `/hermes/apps/browse`，查询键也标注 `workspace-agent`。它属于 workspace-agent 分支，不能当作当前桌面插件目录的数据源。初稿只列模块存在，本轮明确其适用边界。[C16、C20、C21]
2. `use-plugin-detail-apps` 有账号 Link／多账号聚合分支，但其 hosted 判定导入 `app-initial` 的 `fw`；本版 `fw` 返回固定 false。只能说发布包保留了该相应分支，不能说本机桌面启用了这条 hosted Link 路线。**这不等于 Codex 所有连接均不可用**，桌面普通连接另有 `use-app-connect-flow` 路线。[C17、C33]
3. 插件启停／卸载另有 `hostId === durable` 分支，与上一条恒 false 判定不是同一开关。本地和 durable 变体的存在已由导入与正文核对，但当前账户、功能开关、服务策略及入口运行可达性仍未验证。[C10–C12、C34、C35]
4. OAuth 回调地址由主进程返回应用 deep link scheme，路径为 `connector/oauth_callback`。不是本轮已观察到的 localhost HTTP 回调服务器。[C23、C24]

## 3. 应用定义、安装与连接的职责

| 层 | 已观察的静态职责 | 不能据此推出 |
| --- | --- | --- |
| Plugin 定义／发布入口 | 显示名称、描述、来源、版本、能力区块、依赖应用、MCP、Skill、Hooks 等；详情有 page／dialog 变体 | WillYou 需要兼容该 manifest 或安装任意代码 |
| 安装状态 | 详情读取、安装控制器、安装进度、installed inventory、卸载；本地有 app-server 方法 | 安装完成就已连上每个外部账号 |
| App／Connector 元数据 | 名称、图标、支持认证类型、管理员状态、动作；元数据与 runtime 状态分开 | 目录存在就能访问，或者所有动作都获准 |
| Connection／Link | 账号连接、重授权、link ID、连接所有者、多账号选择 | 可用状态、密钥存储位置、已获得全部业务权限 |
| 就绪／启用 | enabled、callable／accessible、reauth、unavailable reason、管理员禁用等分别判断 | 某次查询／发送／回写已经成功 |
| 调用结果 | 生命周期刷新与错误分开，断开成功后仍可能刷新失败 | UI 缓存刷新失败就能安全重做对外操作 |

来源：C01–C22、C29–C31。这里概括的是职责关系；具体字段出现在不同桌面／durable／workspace 分支，不能拼成当前桌面始终使用的一份统一后端对象。

## 4. 目录到详情、安装的调用链

桌面设置 `plugins-settings-39f4509a79cc.js` 的主组件提供插件、应用、Skill、MCP 管理，保留 host 选择、搜索、目录跳转、加载／错误／重试和刷新状态。列表将安装、卸载、启停回调交给卡片；应用行通过共享连接 Hook 进入认证，不把这些动作写成同一个“已接入”按钮。[C01、C04、C13]

详情页面主组件读取插件／安装信息，显示能力与依赖，并提供安装、启用、工具详情、账号连接、断开和设置入口。`plugin-detail-view` 是展示层，`plugin-detail-page` 负责页面级查询、变更、刷新和连接回调；`use-plugin-detail-apps` 负责关联应用的聚合。共同代码也覆盖非桌面上下文，是否显示某块取决于分支与功能开关。[C02、C17、C30]

有界人工导入追踪所得链路：

```text
设置／详情 onInstall
  → app-initial rpr.installPlugin → apr
  → app-shared u$r（安装／详情控制器，校验当前请求）
  → installing：phase / progressPercent / requiresAppPreparation
  → 本地插件安装请求 _kn → app-server plugin/install

设置／详情读取
  → app-server plugin/list / plugin/installed / plugin/read（相关路径）
  → app 查询 app/installed + app/read
     或旧版本回退 app/list（按 cursor 递归）
  → 更新页面查询缓存及后续能力状态
```

以上是跨文件静态路径的组合说明，C29 证明本地请求包装函数存在；本轮未证明安装控制器每个状态到 `_kn` 的所有动态路径，也未完成真正安装。不得将这幅简图写成运行 trace。[C01、C02、C14、C29、C36、C37]

`app/installed` 结果的 enabled／callable 与 `app/read` 元数据分开组合；不支持新方法时，指定兼容错误才退回分页 `app/list`。查询键区分 host、installed 变体以及相关账号，硬刷新与普通读取也是不同动作。对 WillYou 有参考价值的是“查询隔离＋能力协商＋兼容降级”。这些本地 app-server 方法有公开协议文档，不能与后文私有云端点混称；其背后的 OpenAI 云连接能力也不等于可供 M10 复用的业务服务。plugin 方法的生产适用性见[公开协议核对](Codex公开协议与WillYou运行时验证V1.md)。[C14、C15]

## 5. 连接与认证链路

`use-app-connect-flow` 输出当前连接对象、清空连接对象、连接开始、连接成功、OAuth 开始、外部浏览器开始、pending 与 reauth 状态。它允许模态表单、直接 OAuth、继续已有 pending attempt 或外部浏览器路线；具体取决于连接元数据、当前可访问状态、额外字段和功能开关。[C04]

共享认证分发器先解析 connector 支持的认证，再选择 OAuth、API key、无认证或单独的应用专用密码路线；不支持的认证或需额外配置的情况进入失败／表单／浏览器路线，不能对所有应用统一假设 OAuth。[C05–C07、C22]

| 分支 | 静态观察 | 对 WillYou 的可迁移职责 |
| --- | --- | --- |
| OAuth 新连接 | 云端创建链接请求，取得 redirect URL；记录 pending 并打开外部浏览器 | 生成一次连接尝试、区分等待授权与已完成、恢复原页面 |
| API key | 表单值只进入连接请求；请求带 expected identity、signal，设置不自动重试 | 主进程处理秘密、阻止账号切换后的提交；凭据存储另行设计 |
| 无认证 | 创建无认证 Link，与插件安装仍有不同语义 | 本地 Foxmail 来源发现不应伪装成 OAuth |
| 应用专用密码 | 发布包含 iCloud 专门表单与邮箱校验路线 | 说明适配器可有专用认证步骤；不证明公司邮箱支持同样机制 |
| 重连／扩权 | 明确 link ID、reauth reason、requested scopes，有独立 `/reauth` 请求 | 重连原连接和新增第二账号必须区分 |
| MFA／额外设置 | 查询是否需要 MFA、要求去浏览器配置后返回再检查 | 记录前置条件和恢复动作；M10 是否涉及由实际后端决定 |

来源 C05–C07、C22、C31；上表右栏为本项目建议，尚未成为需求确认。API key 路线在发布包中请求 OpenAI 云服务，不能据此推断 Codex 所有凭据本地加密；本轮也未读取钥匙串或账号秘密。

OAuth 状态记录包含 app、host、部分场景的 account/user、oauth state、callback owner、claimed／completed、恢复目标等。客户端代码对 callback 所有者、重复领取、部分账号不匹配及到期尝试作检查。恢复目标可为应用页、安装流程或其他共享场景；较早尝试被替代时有独立页面状态。[C08、C09]

这些是**客户端静态检查**，不证明 OAuth 服务端的 state、PKCE、签名、令牌交换或撤销实现；也不证明所有恢复目标在当前桌面可用。

回调的已知边界：

```text
Renderer Zqr
  → bridge “app-connect-oauth-callback-url”
  → main 返回 <应用 scheme>://connector/oauth_callback
  → 外部 OAuth 完成后回到应用（本轮没有实际触发）
  → Renderer 有 “app-connect-oauth-callback-received” broadcast listener
  → pending 状态校验／恢复／刷新
```

C23–C25 证明 bridge 返回与 renderer listener 两端存在；主进程从 OS 深链事件到该 broadcast 的完整分发链尚未证明。不能补写未观察的 HTTP 监听服务或宣称已跑通 OAuth。

## 6. 启停、断开、卸载和错误恢复

| 动作 | 已知持久化／刷新语义 | 需要保留的状态 |
| --- | --- | --- |
| 停用／启用插件 | 本地写 `plugins.<id>.enabled`，`config/batchWrite` 含 expectedVersion／filePath 与 reloadUserConfig；durable 或远端插件分支请求 enable／disable | pendingPluginId，乐观缓存更新，错误回滚，成功／失败提示 [C10] |
| 启停具体应用 | 设置页使用独立 setAppEnabled 与 updatingAppId；不同于插件级启停 | 行级 pending 与配置不可用 [C01、C04] |
| 断开应用 | 详情有独立 disconnect mutation；成功后刷新多个查询，单独提示“已断开但刷新失败” | 断开失败可重试；刷新失败不能伪装成断开失败 [C30] |
| 卸载插件 | 本地调用 `plugin/uninstall`，受管理插件拒绝；durable 请求 uninstall；之后清缓存、刷新应用／插件并清相关操作态 | uninstalling／pendingUninstallPluginId、错误、历史引用失效 [C11、C12] |
| 全局插件允许开关 | 按 feature 条件显示；修改后提示重启应用 | 不可与逐个插件开关混用 [C26] |
| MCP 登录／配置 | 独立 `mcpServer/oauth/login` 返回授权 URL；支持 STDIO／Streamable HTTP 编辑，已建条目改 transport 需先卸载 | 未认证／starting／错误／保存失败／卸载失败 [C27、C28] |

本轮没有追入 disconnect 的后端实现或令牌撤销端点；不能声称“卸载插件必然撤销所有已连账号”或“断开一定删除所有本地缓存”。WillYou 必须在后续设计里分别定义停用、断开、删除配置、清缓存和保留审计记录的含义。

## 7. 原型页面与状态矩阵

下表是**从静态代码提取的参考状态＋WillYou 候选映射**，不是已经实现的原型，也不是像素或可访问性验收。M10-R01 对应连接管理，R02 对应项目选择，R08 对应错误恢复。当前不改 M9 共享原型。

| 页面／状态 | Codex 已知静态行为 | WillYou V1 原型应准备的状态 | 未验证项 |
| --- | --- | --- | --- |
| 目录／设置 | host／搜索／分类、管理与浏览目录；插件、应用、Skill、MCP 分区 | 禅道、邮件的目录卡与已配置连接入口，框架层保留能力差异 | 当前桌面实际 tab 显隐、排序、快捷键 |
| 列表加载 | loading、empty、load error、Retry、硬刷新 | 初次、刷新、空、离线及加载失败 | 真实延迟、滚动位置保持 |
| 安装／连接中 | 安装进度与连接 pending 分开 | 正在验证、等待外部操作、正在恢复 | 动画时长、取消是否终止远端 |
| 已安装卡片 | enabled 标记；停用后显示启用按钮；菜单 hover／focus／打开态保留 | 已配置与已就绪分开，停用及不可用原因 | 图标精确形状与基线 |
| 详情初次读取 | loading skeleton、失败重试、找不到／不可用 | 详情、账号、能力、状态来源 | 所有断点尺寸与真实长文案 |
| 详情文本 | 标题 break-words，描述 Show more／less，信息行和能力分区 | 名称／服务地址／账号标签长文案、折叠说明 | 实际渐隐／截断阈值 |
| 认证选择 | 支持认证类型决定表单／浏览器／无认证 | 禅道实际认证候选；本地来源与邮件发送分别配置 | 本期最终连接方式待业务讨论 |
| 表单校验 | 配置缺失禁提交，pending 禁连点，错误可见 | 必填、格式、验证失败、保存失败 | 自动聚焦第一错误、读屏播报 |
| 外部认证 | 打开浏览器、pending、回流、被替代、失败 | 有外部流程时保留等待／继续／取消 | OS 深链完整流程、窗口焦点 |
| 多账号／重连 | 连接选择键含 account/user/app；存在 hidden／implicit 过滤与 reauth | 连接实例稳定 ID，重连与新增分别设计 | 当前桌面多账号入口可达性；本期是否多账号待定 |
| 权限不足／禁用 | 管理员禁用、不可用、需设置、连接失效分别显示 | 无权限、认证失败、本地文件不可读、服务不可达 | 各错误是否可稳定区分 |
| 断开／卸载 | 分开变更与结果；可区分操作成功但刷新失败 | 停用／断开／删除三类动作的候选说明 | 清理范围及确认方式待业务讨论 |
| 连接作用范围 | host／账号隔离；workspace-agent 另有共享账号警示 | 全局连接、项目选用、任务授权为独立候选 | 不复制团队共享业务；归属决策待定 |
| 浅／深色、焦点 | 使用语义色与 focus-visible 类 | 明暗、hover、选中、focus、disabled、长文本全套 | 未实际截图，不宣称视觉一致 |

### 7.1 细粒度视觉来源

原始代码锚点 C13、C38–C43 可直接复核。CSS 数值必须结合窗口类型、主题、缩放、父级覆盖和字体配置，不能直接把 Tailwind 默认尺寸当成 Codex 的 computed style。

| 部位 | 已找到的源码约束 | 尚缺／不能承诺 |
| --- | --- | --- |
| 桌面字体 | 共享样式含 Electron `text-sm:13px`、`text-xs:12px`、UI weight 430，medium 500；系统字体堆栈可被 font-ui-family 覆盖 [C38] | 当前字体实选、字距、fallback、用户字体设置、每个控件 computed line-height |
| 详情标题 | `heading-base electron:heading-lg`、min-w-0、break-words；语义 text-default [C40] | 最终字重／行高／字号须按 Electron heading 规则和继承复核 |
| 详情区块 | `--detail-page-inline-inset`、gap-3／gap-4、text-sm；说明 leading-5，段落可选文本 | inset 的实际父值、各断点宽度及滚动容器 |
| 设置容器 | `max-h: calc(100dvh / --codex-window-zoom - 2rem)`、overflow-hidden；列表内部 min-h-0／flex-1 [C43] | 弹层宽度、坐标、标题区和 footer 实际尺寸 |
| 连接骨架 | gap-6，px-6／pt-8／pb-6；logo size-14／rounded-xl；底部 h-9，分行 border [C41] | 登录表单各分支不同，不把骨架／iCloud／Google 装饰预览混作通用弹层 |
| 图标尺寸 | 共享 CSS icon-sm 18×18，base 20×20，md 24×24，lg 28×28 [C39] | 实际 glyph 路径、填充／描边、可合法复用资源和最终对齐；尚未导出图标 |
| 卡片操作 | 菜单默认 invisible／opacity-0，group-hover 显示，打开态保持；触发器 hover／focus-visible 提升 opacity；启用按钮阻止冒泡 [C13] | pointer 精确命中范围、菜单定位和键盘导航实际行为 |
| 焦点／动效 | 部分详情小动作显式 focus-visible ring；骨架 motion-safe pulse，部分动画 motion-reduce [C42] | Tab 顺序、Esc／Enter、焦点陷阱、打开／关闭后焦点恢复未执行验证 |
| 圆角／颜色 | 边框、背景、文字使用语义变量；radius 受 corner-radius-scale 和 superellipse 支持影响 | 各主题最终 RGBA、阴影、透明度和平台渲染；不能按类名写“完全一致” |

这里的视觉准备足以列原型核对项目，不能代替真实桌面页面截图。业务确认后应在 M10 原型中逐项标来源、保存快照和哈希；当前未生成 M10 UI，也未修改 M9。

## 8. 本地／云边界与 WillYou 迁移建议

| 边界 | Codex 证据 | WillYou 技术候选（待设计确认） |
| --- | --- | --- |
| 界面→领域服务 | 页面查询／mutation 和展示组件分开 [C01、C02] | Renderer 只调用统一连接服务，不直读邮件库或带秘密请求内网 |
| 本地运行时 | host 定位的 app-server 管理插件／MCP／应用状态 [C10–C15、C27、C29] | 复用主进程 IPC、加密配置、项目上下文和已有 CLI 注入机制 |
| 远端身份与连接 | `/aip/...` 连接、认证及元数据服务；durable 插件有 `/ps/...` 状态 [C05–C08、C10、C11] | 禅道、Foxmail、发信分别实现 provider；不依赖 OpenAI 私有端点 |
| 本地数据源 | 本轮 Codex 连接证据未覆盖 Foxmail 存储 | `LocalMailSource` 与 `MailSender` 分开；纯云邮箱连接不能补回已从服务端删除的历史 |
| Agent／M11 消费 | 本文只验证管理侧，不承担工具调用运行证明 | 同一 provider 能力契约供 UI、Agent、后续调度调用；策略检查放主进程 |

建议最小职责为 `ProviderDefinition`（能力与认证描述）、`Connection`（实例／状态／凭据引用）、`ConnectionAttempt`（验证／恢复）、`Capability`（查询／草稿／发送／回写等）、`InvocationRecord`（结果与错误）。这些名称是 WillYou 设计候选，不是 Codex 对象复刻，也未决定本期采用完整插件市场。

候选状态轴分开保存：配置状态、认证状态、来源／服务可达性、enabled、能力许可、执行结果。状态转换不能以“保存配置成功”替代“数据能读取”，也不能以“收到回调”替代“账号及权限已核实”。首版是否多账号、账号／项目归属、发信及禅道回写授权方式属于业务决定，保留未决。

## 9. 调查清单与剩余边界

| 问题 | 本轮程度 | 下一项证据 |
| --- | --- | --- |
| 桌面目录→详情→安装职责 | 部分回答，入口、回调、管理端点和状态已定位 | 选定真实页面无变更运行观察；安装控制器最终动态路径 |
| 连接表单／OAuth 原理 | 静态主要链路回答 | 目标适配器隔离实验，不能用 OpenAI 接口替代 |
| OS 深链→回流 listener | 部分回答，已知是应用 scheme | 主进程深链分发、异常／重复回调的实际验证 |
| 启停／重连／断开／卸载 | 静态主要职责回答 | disconnect 服务端清理和权限撤销语义；打包应用验证 |
| 本地与云／workspace 适用边界 | 已区分，恒 false 分支已勘误 | 当前账户功能开放与运行可达性不在本轮证明范围 |
| 样式与微交互来源 | 部分回答，token／类／关键状态可追溯 | 浅深色、选中、hover、焦点、长文本真实截图及 computed style |
| 凭据、权限的真实执行位置 | 未回答服务端内部；未读秘密 | WillYou 本地实现契约与隔离实验；不猜 Codex 云端源码 |
| Foxmail 数据、禅道 Bug／Story 及发信 | 由专项调研承接 | 真实版本／API／本地格式验证与缓存、增量、错误恢复 |

本轮回答了通用接入应怎样拆职责，并给出源码证据和可用于原型准备的状态表；运行、视觉和后端清理未验证项保留。没有安装插件、连接或断开账号、触发 OAuth、发送邮件、回写禅道，也没有读取私有会话／凭据。本报告不构成 M10 开发批准或验收通过。
