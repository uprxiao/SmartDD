# Codex 三方应用接入初步调研

2026-10-17。依据：[M10 需求 R1.1](../需求.md)，M10-R01／R02／R07／R08。状态：**初轮静态取证与官方文档核对**；本报告不代表详细调研、真实授权或视觉验收已完成。

后续版本：[生命周期REA V1](Codex接入生命周期REA_V1.md)与[使用链路REA V1](Codex接入后使用链路REA_V1.md)。本稿保留初轮历史；新版已明确`/hermes/apps/browse`属于workspace-agent目录，特定hosted Link分支在本机包受恒false门控，不可把这些模块直接当作当前桌面完整接入行为。最新覆盖与实验见[总览](调研总览V1.md)。

## 1. 标的与证据

本机 `/Applications/ChatGPT.app/Contents/Resources/app.asar` 的 bundle id 为 `com.openai.codex`，版本 `26.1007.30912`，build `20156`。目录名不作为产品身份依据。ASAR SHA-256：`75e397e2280dde93b70a85aa926f4282c728eacc84dfeb15ba7fb6ddd84628af`。

REA 对 7 个明确选定的 JavaScript 成员作惰性静态解析，读取 26,321 bytes，7 个解析成功、0 个解析失败。父 Evidence：`ev_0eda4b3d9113f460f5efe8bfb9f4b4097abc513277a758955d84e68b990df873`；摘要 Evidence：`ev_253172dd888d76a34285b97cff5c79cdec6b9f530eeef33655b1232e83fad71f`。成员、哈希、ASAR 偏移、摘要与限制见[证据元信息](证据/codex-integration-source-locations.json)，逐个与原 ASAR 字节核对一致；该文件不含原始实现代码。

首次默认完整性检查报告 unpacked 原生成员不匹配；随后以 `record-and-continue` 记录继续，最终列出 7 个原生成员完整性矛盾。原因未查明，不推定为签名所致；这些原生成员不在选定的 7 个 JS 分析范围内。整体关系图为 partial，16,233 个未选文件及动态依赖未分析，不能推广为完整应用行为。

## 2. 静态观察

以下是选定模块正文与 REA 静态语法的核对，不是实际点击、登录或远端执行。发布包含多个界面的共用模块，特别是团队／workspace-agent 分支；不能据存在某组件断言当前桌面账号能访问。

| 问题 | 观察 | 成员（均在 webview/assets 下） |
| --- | --- | --- |
| 应用定义是什么 | 目录、指定应用元数据与动作查询分开；元数据包含来源、图标、状态及支持的认证类型 | `apps-query-6b7fde21fbea.js`：`p/l/u/m`；目录分 recommended／workspace／public，属于对应分支 |
| 安装与连接是否相同 | 连接 setup 在当前路由状态中核对 accountId、userId、connectorId 和 attempt，随后分别调用安装与 setup 回调 | `plugin-connector-setup-b2224d74d5e6.js`：`m/h`；未追入回调实现，不能证明 OAuth 服务端校验 |
| 已连接是否可调用 | 判断需要连接时检查 reauth、不可用原因、管理员禁用；还有 workspace link 的 enabled／conflict | `plugin-required-apps-7dfc69ac668b.js`：`y/x` |
| 插件能否依赖其他应用 | app manifest 的 required apps、template alternatives 参与所需连接集合 | 同上 `b`；不等于 WillYou 必须兼容该格式 |
| 多账号选择怎样区分 | 按 connector 过滤 link；选中 link 的 UI 存储键含 accountId、userId、appId，且过滤 hidden／implicit link | `plugin-connected-account-links-686de994788f.js`：`g/v/h`；不代表凭据存储位置 |
| 连接界面有哪些状态 | 团队连接管理有 loading、empty、load／save error、disabled、needs connection、connected、auth-free 及重试；支持独立移除与只读设置分支 | `plugins-connections-modal-c41fa33b3ffa.js`：`Le/Be`；只读切换受功能开关影响，未验证实际后端执行 |
| MCP 如何在设置出现 | MCP 设置容器复用插件设置组件，以 manageOnly 模式呈现 | `mcp-settings-83d0520492d3.js`：`d`；深层组件未追踪 |

`plugin-detail-settings-enabled-f310414c3b63.js` 也纳入取证，但本轮不据其薄封装推断完整启停行为。上表中的内部端点只是发布包实现定位，**不是公开 API 或可供 WillYou 复用的服务契约**。

## 3. 官方文档核对

2026-10-17 通过 OpenAI Docs 搜索并实际读取：

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)：公开文档区分 app 元数据／installed runtime state 与 MCP 的状态、OAuth 登录及工具调用。本文只用于核对职责边界，未调用本机 app-server。
- 同页将 plugin/list、read、install、uninstall 标为开发中，并明确当前不应从生产客户端调用。不能因发布包中有插件界面，就直接选它们作为 WillYou 的生产依赖。
- [MCP Streamable HTTP 配置](https://learn.chatgpt.com/docs/extend/mcp#streamable-http-servers)：配置可含认证方式、bearer 环境变量及 header 来源；OAuth 登录为独立步骤。具体认证仍取决于实际 MCP 服务，不能据此推定 Foxmail／公司邮箱支持 OAuth。

## 4. 对 WillYou 的建议与未决

建议借鉴“应用定义→连接实例→就绪／权限→具体能力调用”的职责分工；页面、Agent 和后续定时任务共用主进程服务。禅道与邮件分别适配，本地 Foxmail 读取与发信也可以采用不同通道。此为本项目设计建议，不是 Codex 实现复刻结论。

| 调研问题 | 当前回答程度 | 后续工作 |
| --- | --- | --- |
| 通用框架是否有参考 | 部分回答：有静态分层及公开协议职责证据 | 细化本项目连接、生命周期与工具契约 |
| 实际桌面连接授权全过程 | 未回答 | 在用户需要的目标应用范围内补官方说明或受控验证，避免收集账号秘密 |
| 精确原型与视觉／微交互 | 未回答，无本轮截图 | 确定业务路线后核对真正适用的设置／详情／连接页面，记录浅深色等状态 |
| 禅道实际闭环 | 未回答 | 确认版本、认证与回写范围，查真实接口和现有 Skill 复用 |
| 本机 Foxmail 兼容 | 另行只读调研 | 本地来源为必要输入；不以服务端查询替代已下载历史邮件 |
| CLI／MCP／打包业务可用性 | 未验证 | 隔离实验与用户授权后的正式实现、验收分别记录 |

本轮没有打开授权页面、改变连接、发送邮件、回写 Bug、操作用户聊天或修改 Codex 安装包。详细设计、原型和测试用例仍待后续工作。
