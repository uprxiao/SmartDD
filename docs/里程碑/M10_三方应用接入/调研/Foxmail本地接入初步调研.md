# Foxmail 本地邮件接入初步调研

2026-10-17。依据：[M10 需求](../需求.md)，M10-R05／R06／R07／R08。用户明确要求优先兼容本机 Foxmail，收取后邮件在服务端被删除，历史数据只保留本地。服务端策略为用户描述，本轮没有连接邮箱服务器。

本稿为初轮历史；后续[可行性V1](Foxmail接入可行性调研V1.md)已补REA包身份、只读schema、3个真实邮件MIME结构与合成实验，最新已知／未知按V1阅读，不将本稿的“尚未做”覆盖新增证据。

## 已观察事实

| 项目 | 本机证据与结果 |
| --- | --- |
| 应用身份 | `/Applications/Foxmail.app/Contents/Info.plist`：`com.tencent.Foxmail`，版本 `1.5.8`，build `94590` |
| 声明的系统入口 | Info.plist 仅注册 `mailto` URL scheme；声明 EML／message-rfc822 的 Viewer。不能据此证明可搜索、读历史邮件或无人值守发送 |
| 脚本能力 | plist 无 `NSAppleScriptEnabled`／`OSAScriptingDefinition`，bundle 资源未找到 sdef；静态 `sdef` 提取返回 `-10827`。当前没有可核实的 AppleScript 邮件对象模型，并非证明不存在一切自动化方式 |
| 数据根 | `/Users/liubu/Library/Containers/com.tencent.Foxmail/Data/Library/Foxmail/`，含 Profiles 等目录；未读取 Preferences 值、日志和凭据 |
| 本地索引 | `Profiles/<账号目录>/messages.db` 文件头为 `SQLite format 3`；以 `mode=ro` 和 `PRAGMA query_only=ON` 读取 schema，没有查询任何邮件行 |
| 索引结构 | 11 张表，包括 mailinfo、boxes、mail_box_info、attachmentinfo、body_structure、mail_meeting_info、meta 及 4 张 FTS 表；mailinfo 含 mailid、messageid、date、readstat、fileexist、mail_download_type、popdeleteservercache 等字段。字段存在不等于其业务语义已验证 |
| 内容存储 | 对应 Mail 目录以 `.mail` 私有文件为主；仅查扩展名和单个文件魔数，魔数未识别，**不能将 .mail 当作 EML**，未读取正文和附件内容 |
| 读取限制 | 标准 Python SQLite 对 FTS 检查报 `unknown tokenizer: icu`；部分配套库只读报 `database is locked`。不能据此承诺稳定后台索引或任意 SQL 可直接运行 |

本轮未启动／退出 Foxmail，未写入、复制、修复或迁移活动邮箱数据库；未读取账号密码、主题、正文及附件内容。账号目录在报告中隐去。

## 官方文档

实际打开的 [Foxmail 官方 Mac 页面](https://www.foxmail.com/mac/)更新日志记载 EML／MBOX 导入导出、打开本地 EML、POP 收取后删除服务器邮件以及正文／附件分离下载等能力。它能支持标准导出作为候选后备路径；不能代替对用户当前配置或每封邮件完整下载状态的验证。

本轮没有找到可确认的 Mac 私有存储格式规范或完整脚本 API；Windows 7.x 的帮助不能直接当作本机 Mac 1.5.8 接口说明。

## 建议与待验证

建议首先验证 **Foxmail 本机只读适配器**：识别版本与来源，读取索引及对应内容，为 WillYou 建立独立的查询／引用关系，保持原邮件数据只读。服务端读信只在后续有合适用途时补充，不能替代本地唯一副本。

若私有格式或活动库一致性无法稳定支持，评估 Foxmail 官方 EML／MBOX 导出作为后备。导出需要用户／客户端参与，与自动持续同步的体验有差异，不能默默将“自动读取本机邮件”降为“每次手工导出”。

读取与发送分别设计。当前 `mailto` 仅提供系统撰写入口的候选；尚未验证自动创建完整草稿、带附件、实际点击发送或可核实的发件结果。如需独立发送通道，应另行确认公司系统的 SMTP／API、网络与授权，不提取 Foxmail 密钥来推定发送能力。

后续验证：`.mail` 正文／MIME 格式、附件关联与缺失、稳定 ID 和增量标识、活动库一致性／锁定恢复、权限、版本升级、标准导出保真度，以及 Agent 对本地对象的引用／检索。当前尚无正文读取、增量同步或实际发信已通过结论。
