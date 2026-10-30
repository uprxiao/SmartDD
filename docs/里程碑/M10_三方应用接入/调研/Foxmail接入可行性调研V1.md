# Foxmail 接入可行性调研 V1

2026-10-17。依据：[需求 R1.2-20261017](../需求.md)，覆盖 M10-R05、R06、R07、R08；承接[初步调研](Foxmail本地接入初步调研.md)。状态：技术候选与有限实验已形成；未批准生产开发，未完成真实业务验收。用户要求优先 Foxmail、本地历史不可由服务器查询替代，作为已确认输入；服务器删信策略仍为用户陈述，未连接验证。

## 1. 本轮结论

优先验证 **Foxmail 本地索引＋邮件源文件的只读适配器**，为 WillYou 建立独立查询索引和引用关系。三个最小 `.mail` 样本先验证了邮件头布局，随后完成有界的完整文件 MIME 结构解析：均未报告解析缺陷，识别了正文变体、内嵌资源和附件结构。没有输出或保存真实头值、正文、附件内容、文件名、ID或内容哈希；仍不能称为“Foxmail 内容保真与完整接入已通过”。

发件应独立选型。目前没有找到可核实的 Foxmail 脚本发件 API。`mailto` 和 EML Viewer 只能作为客户端交接候选；它们不能证明选择发件账号、加入附件、持久草稿、无人值守发送或实际发件结果。Apple Mail 静态字典和独立 SMTP／服务 API 是可继续验证的后端，仍需要用户选定通道及必要配置。读取和发送不必共用同一客户端，也不能因这项技术建议擅自迁移邮箱。

## 2. 方法、环境与证据

环境：macOS 26.6.1、arm64，Python 3.11.9。当前分支 `feature/0.0.1`，基线为含其他 Agent 改动的工作区；本轮只新增本调研和[独立实验目录](../技研/实验/foxmail/README.md)，不修改生产业务、共享原型或 M10 主方案。

本轮使用 REA `open_binary` 绑定 `/Applications/Foxmail.app`，执行静态 `inspect_plist`、`inspect_macho`，随后 `close_binary`。没有运行 Foxmail 进程或执行其代码，没有开启邮箱、收信、发件或 UI 自动化。

| 证据 | 实际观察 | 限制 |
| --- | --- | --- |
| F-E01：[REA plist](../技研/实验/foxmail/rea-plist-evidence.json)；Evidence `ev_5d7cedb12c743b9125f8cae0934b1a84705cd2521585f40fcee04c72557ff5bc` | `com.tencent.Foxmail`，1.5.8，build 94590；注册 `mailto`，声明 EML／`message/rfc822` Viewer | 系统入口声明不证明实际操作成功 |
| F-E02：[REA Mach-O 摘要](../技研/实验/foxmail/rea-macho-summary.json)；原始父证据 `ev_49511e95eb1555f7b1e6e5cbb46389114527880ad96981ce0030f8cfbb195eb9` | 本机可执行文件为 x86_64 单架构；SHA-256 `b64f0b4edeac18eaa1496e361a64fecd68a454dec7afbb8594755ef8e8208e48` | 导入／导出非穷尽；未做控制流反编译。官网后来同名 1.5.8 的 Apple Silicon 更新不能套用为本机包事实 |
| F-E03：[私有格式统计](../技研/实验/foxmail/private-format-report.json) | 指定数据根中 SQLite schema 与三个 `.mail` 的有限布局 | 无邮件行值、头值、正文、附件或账号名；不含原样本拷贝 |
| F-E04：[标准客户端接口](../技研/实验/foxmail/standard-client-interfaces.json) | Foxmail 无 sdef 声明；Apple Mail 有脚本对象及发件命令 | 只检查静态资源，不证明账号已配置或能发信 |
| F-E05：[合成解析实验](../技研/实验/foxmail/synthetic-parser-report.json) | 12 项合成检查通过 | 不是真实 Foxmail 邮件验收 |
| F-E06：[真实 MIME 结构统计](../技研/实验/foxmail/private-mime-structure-report.json) | 原确定性选样顺序的 3 个完整 `.mail`，逐文件不超过 2 MiB；结构解析无 reported defects | 只归档匿名类型／计数／大小，不展示或保存真实内容；不是客户端逐项保真、native ID 映射或全部邮箱验收 |

全部本地产物哈希见[evidence-manifest.json](../技研/实验/foxmail/evidence-manifest.json)。CLI 的本机可读结果不能证明打包 WillYou 已获得相同权限；Apple 对其他 App 容器访问提供 `NSAppDataUsageDescription`，对发送 AppleEvents 提供 `NSAppleEventsUsageDescription`。实际打包态许可、拒绝和撤销恢复仍需验证。[Apple 容器访问说明](https://developer.apple.com/documentation/BundleResources/Information-Property-List/NSAppDataUsageDescription)、[AppleEvents 说明](https://developer.apple.com/documentation/bundleresources/information-property-list/nsappleeventsusagedescription)

## 3. 本地读取：确证与候选

### 3.1 数据与格式

已定位根：`/Users/liubu/Library/Containers/com.tencent.Foxmail/Data/Library/Foxmail/`。账号目录在证据中统一写成 `<account>`，没有归档其真实名称。

`Profiles/<account>/messages.db` 是 SQLite。再次以 `mode=ro`、`PRAGMA query_only=ON` 读取了 `mailinfo`、`boxes`、`mail_box_info`、`attachmentinfo`、`body_structure` 的列名与类型，没有 `SELECT` 邮件行。相关结构包括：

- `mailinfo`：`mailid/messageid/readstat/fileexist/mail_download_type/mail_receivedate/popdeleteservercache` 等。
- `mail_box_info`：邮件 ID、文件夹 ID、UID、服务器键等关联字段。
- `attachmentinfo/body_structure`：附件 ID、邮件 ID、大小、存在标记与 MIME 结构相关字段。

上述字段说明存在可研究的结构，不证明其取值语义、ID 稳定性或关联关系已正确还原。`mail_fts` schema 检查仍报 `unknown tokenizer: icu`；不能依赖系统 SQLite 直接接管 Foxmail 全文索引。普通表的只读 schema 能读，亦不能推定所有真实业务 SQL 都能执行。初轮配套库锁定现象保留，未进行修复、checkpoint、改 journal 模式或活动库复制。

本轮 3 个 `.mail`，每个最多读取 65,536 字节，只计算结构统计。观察如下：

| 样本 | 读取字节 | 标准头字段名位置／CRLF 分隔 | 读取期间变化 |
| --- | ---: | --- | --- |
| 1 | 17,158 | 出现 From／To／Subject／MIME-Version／Content-Type／Date／Message-ID；首个 CRLF 空行偏移 668 | stat 稳定 |
| 2 | 9,678 | 同组字段；首个 CRLF 空行偏移 814 | stat 稳定 |
| 3 | 65,536（截断前缀） | 同组字段；首个 CRLF 空行偏移 1,622 | stat 稳定 |

三个样本前 64 字节均为可打印文本；未匹配本轮检查的 SQLite／ZIP／GZIP／zlib／MBOX `From ` 前缀。布局阶段没有输出字段值、原始字节或文件名，也没有调用 MIME 解析。随后按原确定性选样顺序补做完整文件结构解析，三个文件大小均与原记录一致；本轮未保存身份字段，因此这些元数据不是跨期永久身份核验。

补充探针限制每个完整文件至多 2 MiB、256 个 part、24 层、8 MiB 解码叶项；超文件预算直接 skip，绝不对截断前缀宣称完整解析。只读，不渲染、不访问网络、不写源库。结果如下：

| 匿名样本 | 完整文件字节 | MIME／part 数 | 结构与解码统计 | 缺陷／一致性 |
| --- | ---: | --- | --- | --- |
| 1 | 17,158 | multipart/alternative；3 part、2 叶项 | 有 plain／HTML；无内嵌资源标记、附件计数 0；叶项解码 11,768 字节 | 无 reported defects；stat 稳定 |
| 2 | 9,678 | multipart/alternative；3 part、2 叶项 | 有 plain／HTML；无内嵌资源标记、附件计数 0；叶项解码 6,204 字节 | 无 reported defects；stat 稳定 |
| 3 | 476,544 | multipart/related；7 part、5 叶项 | 有 plain／HTML／内嵌资源；附件或含文件名叶项 3，解码 308,944 字节；全部叶项解码 345,626 字节 | 无 reported defects；stat 稳定 |

三个样本均未触及预算，未识别出加密 MIME 类型；没有验证签名或执行解密。“内嵌资源”按 MIME Content-ID／inline 标记判定，附件计数包含带文件名的叶项，不代表已对照客户端证明 3 个独立下载附件完整。**已证实：这三个 `.mail` 完整文件可被标准 MIME 解析器结构化。** 未比较真实可见内容、解码正确性、客户端附件清单或全部格式，不推广为其他邮件已通过。

### 3.2 原生只读适配器候选

建议把以下工作分开，而不是让 Agent 直接遍历 Foxmail 数据根：

| 层 | 候选职责 | 验证关口 |
| --- | --- | --- |
| 来源登记 | 用户选定来源；记录本机生成 source UUID、可执行包身份和 schema 指纹 | 多账号、改名、升级、路径迁移、权限撤销；不以账号地址作为公开引用 ID |
| 只读库存 | 受限连接读取指定普通表与邮件 ID，验证文件对应关系；失败显示锁定／不支持 | 不修改 Foxmail 任何索引或标记，不因扫描失败认定“邮箱为空” |
| 内容解析 | 有限字节／深度的 MIME 解析，输出正文变体、附件描述、缺失与缺陷状态 | 已验证 3 个真实样本结构；内容语义保真及缺失附件仍未核对；S/MIME／加密邮件不能擅自解密 |
| WillYou 索引 | 自有索引与缓存，由内容版本更新；默认不复用 Foxmail FTS | 缓存范围、正文保存与删除策略待评审；FTS／ICU 失败隔离于来源读取 |
| 引用与工具 | 用 `source UUID＋经验证的 native ID` 关联，正文和附件按获准范围取用 | `Message-ID` 可能缺失／重复，不能单独作为本地对象主键；目前 native ID 与文件映射未知 |
| 变化检测 | 仅观察本地已落盘变化，退避后重读；处理半写入、移动与删除 | 不等于触发 Foxmail 收信；客户端停止后仍可读历史的边界和新数据状态须验证 |

候选引用需把“同一条邮件内容修订”“相同 Message-ID 的不同记录”“不同来源相同 native ID”区分开。内容 hash 可检测版本变化，不能凭 hash 静默合并业务记录。附件用 part ID／内容 hash 的受控文件名保存，原始附件名只作显示；生产实现还需验证大小、层级、解码预算、路径与符号链接边界。预览先采用纯文本，HTML 要单独验证清洗和远程资源控制；本轮合成实验没有验证 HTML 渲染器。

### 3.3 官方导出后备

[Foxmail 官方 Mac 更新日志](https://www.foxmail.com/mac/)记载 EML／MBOX 导入导出、打开本地 EML、正文与附件分离下载、POP 收取后删除服务器邮件。这支持标准导出作为后备接入，但没有核实当前客户端导出过程、附件保真或全部历史数据。不能把官网的功能说明当作当前用户邮箱完整性的证据。

后备模式应明确标为“导出来源导入”，展示来源时间与缺失状态；不会自动提供持续新邮件同步，也不能默默替换用户要求的本机历史查询体验。服务端 IMAP／API 可另作补充，无法取回已从服务器删除且只剩本机的数据。POP 删除机制有协议定义，但本轮未验证用户账号实际策略。[POP3 RFC 1939](https://www.rfc-editor.org/rfc/rfc1939.html)

## 4. 发信：候选与结果语义

### 4.1 Foxmail 的已知接口边界

本机 Info.plist 未声明 `NSAppleScriptEnabled`／`OSAScriptingDefinition`；Resources 未发现 `.sdef`／`.scriptSuite`，初轮静态 `sdef` 返回 -10827。本轮公开检索限定 Foxmail 官方域的 Mac／AppleScript／API／自动化材料，没有找到可核实的 Mac 脚本对象或发件契约。这是**限定搜索内未确认**，不是证明不存在所有自动化方式。

| 通道 | 证据与能做的候选 | 目前不能承诺 |
| --- | --- | --- |
| `mailto` 交给客户端 | Foxmail 声明 scheme；可作为收件人、主题、短纯文本的撰写交接研究 | 指定已配置发件账号、任意 MIME／附件、持久草稿、直接发送及结果确认；尚未实际调用 |
| EML 文件交接 | Foxmail 声明 Viewer，官网支持本地 EML | 打开 EML 可能是阅读，不是创建可发送草稿；未验证编辑／发出 |
| Foxmail UI 自动化 | 只作为需运行态研究的候选 | 未检查实时 UI 和辅助功能树；焦点、窗口、账号与按钮定位及版本变化未知，不应成为已验证默认后端 |
| Apple Mail AppleScript | 本机 `/System/Applications/Mail.app/Contents/Resources/Mail.sdef` 明确声明 outgoing message、send／reply／forward；send 声明返回布尔值 | 未读取其账号或邮件、未发送 AppleEvent、未发信；不能因此推定公司邮箱能接入。`reply` 接收 Mail 自身 message 对象，不能直接传 Foxmail ID |
| 独立 SMTP／企业邮件 API | 可在通用发送能力下适配明确授权的账号与服务 | 当前公司服务协议、地址、TLS／认证、网络及账号权限未提供；不提取 Foxmail 密钥来补齐，也不把“类似 Outlook”推断成某种 API |

`mailto` 的 `body` 面向短纯文本，不是通用 MIME 容器；协议还要求客户端在发送前向用户展示信息并请求同意，不能据 scheme 交接声称已发送。[RFC 6068 §2、§7](https://www.rfc-editor.org/rfc/rfc6068.html)

本机 Apple Mail 为 16.0，build 3864.700.51.1.1；只检查了其静态字典。默认 `/Applications/Microsoft Outlook.app` 不存在，未扩大查找，也未检查用户邮箱。Apple Mail 可以作为另行选择、配置并验证的发件后端，不能当作 Foxmail 现成发件接口或历史邮件读取替代。

### 4.2 通用发信状态候选

建议至少区分 `draft_prepared`、`handoff_requested`、`client_reported_success`、`server_accepted`、`failed`、`result_unknown`。这组名称是技术候选，未形成业务确认基线。

撰写交接只记录交接；客户端命令成功只记录客户端反馈。直接 SMTP 在 DATA 后取得成功回应，表示服务器接受后续投递责任，仍不是收件人实际收到／阅读的保证。[SMTP RFC 5321 §4.2.5](https://www.rfc-editor.org/rfc/rfc5321.html)

本地发送 intent ID 只能防 WillYou 重复提交，不能冒充邮件服务器幂等键。断网或超时进入结果未知后，需要按获准通道核对发件状态，不能直接自动重发。回复／附件是否本期交付、逐次确认或范围预授权、需要何种发送证据，暂列业务待决；本轮不推进真实发件。

## 5. 合成实验实际结果

实验仅使用 Python 标准库 `EmailMessage/BytesParser/mailbox.mbox`，没有安装依赖；合成消息使用 `.invalid` 地址，临时附件与 MBOX 在实验结束清理。标准库提供 MIME 解析与缺陷信息，MBOX 模块提供容器处理；它们不理解 Foxmail 专有索引和业务状态。[Python email.parser](https://docs.python.org/3.11/library/email.parser.html)、[Python mailbox](https://docs.python.org/3.11/library/mailbox.html)

| 检查 | 结果 | 所能支持的结论 |
| --- | --- | --- |
| S01–S02 UTF-8、multipart、纯文本／HTML、CID、附件分离 | 通过 | 标准 MIME 解析可作为适配器模块候选；HTML 未渲染，未访问远程资源 |
| S03–S06 重复／缺失 Message-ID、来源隔离、内容修订 | 通过 | 自有引用必须独立于头 ID；验证的是合成 source/native ID |
| S07 坏 MIME | 通过 | 解析缺陷可被记录，不能静默标完整 |
| S08–S10 附件路径穿越名、同名、输出权限、配额 | 通过 | ID/hash 隔离与提前配额策略可行；不是所有攻击面的安全验收 |
| S11–S12 MBOX 消息边界／包装身份 | 通过 | 合成 MBOX 包含两封邮件，正文 From 行未被误分第三封；容器字节身份与邮件引用分开 |

**12 项通过全部属于合成解析层。** 另有 F-E06 的 3 个真实样本结构解析结果；两者证据独立。没有真实内容与客户端逐项保真、DB 行与文件关联、活动邮箱同步、客户端草稿或发送通过结论。

## 6. 后续验证、阻塞与待决定事项

| 项目 | 当前事实／阻塞 | 下一步所需证据 |
| --- | --- | --- |
| `.mail` 真实解析保真 | 3 个完整样本结构解析无 reported defects；未展示／归档任何实际内容 | 后续在明确获准的小样本内对比客户端：正文变体、编码、内嵌资源、附件与缺失状态；结构解析不代替内容保真 |
| 稳定 native ID 与文件映射 | schema 有候选字段，未读行值 | 用获准最小样本检验 mailid、文件路径、移动／重建／删除及重复 ID 行为 |
| 活动库一致性／增量 | 普通 schema 可读，FTS 有 ICU 限制，初轮部分配套库曾锁定 | 打包态只读事务、超时与退避；半写入／大文件／客户端更新／升级恢复，不能通过写源库排障 |
| 全部历史附件 | 官网明确正文附件可分开下载 | 对未下载／缺失／超大附件与本地独有内容分类，不能仅凭 mailinfo 记录称完整 |
| 系统权限 | CLI 可读不代表 App 可读 | 用户选择来源与许可拒绝／撤销恢复，打包 WillYou 的容器访问校验 |
| 发件后端 | Foxmail 无已证实脚本 API，其他通道未配置 | 用户选定 Foxmail 交接、Apple Mail 或独立服务；再验证账号、草稿、附件、回复及真实结果 |
| 跨客户端回复 | Foxmail ID 不等于 Apple Mail message 对象 | 另查通道支持的 In-Reply-To／References 或客户端对应关系，不自动迁移邮箱 |
| 缓存与授权业务 | 仍为 R1.2 待沟通 | 正文／附件保存策略、多账号、项目可见范围、确认机制、首版平台及实际收发边界 |

技术上可以继续推进来源适配和标准格式模块的设计，但读取全流程与发件后端仍未被证据闭合。Windows／Linux 与其他 Foxmail build 均未验证；不沿用本机结论。业务待决保留，不为凑齐“可行”擅自选择邮箱服务、修改删信策略或执行真实发送。
