# R3.4 GAP-07 真实 viewer 与 CLI 图像载荷供应核查

2026-10-17；对应 R06.18、V05/V06。已完成供应核查及**官方第三方 PDF viewer 的隔离只读闭环，18/18 检查通过**。这证明候选能真实读取并显示本机合成文件，不代表 WillYou 已接入或正式验收通过。

## 已确认的供应事实

| 对象 | 已确认事实 | 当前缺口 |
| --- | --- | --- |
| WillYou / REA | `file-viewer-policy.mjs:5–10` 只判断 resources 能力；`FileWorkspace.jsx:755` 图片引用仍生成上下文字符串；`src/shared/events.ts:20` PTY 输入是字符串。R3 MC01 的 REA 服务没有 resources。 | 没有实际第三方 HTML viewer 宿主或图片附件通道；历史握手不证明 R06.18/V05/V06。 |
| 官方 MCP Apps PDF viewer | **@modelcontextprotocol/server-pdf 2.0.3**；npm gitHead 与上游固定 commit 均为 `82221c0c8ce7661efa6771c9d461511b1650495f`。已通过真实 MCP 读取合成 PDF、加载未修改的官方 HTML 并绘制页面。 | 仅隔离只读候选实验；M9 产品宿主、真实项目与 ifMatch 写回尚未接入。 |
| Yoda 原生图片粘贴 | `../yoda/src/main/core/conversations/impl/image-attachments.ts:130–155` 把文件解码为 nativeImage，写系统剪贴板并向 PTY 发 Ctrl+V；注册表给 Claude 开启该能力。 | helper 会自动提交，解码失败降为 `@path`；均不能原样照搬。500ms 等待不是接收确认，剪贴板恢复也不是所有格式的完整快照。未运行 Yoda 或用户 CLI。 |
| Claude / Codex 官方协议 | Claude SDK streaming user message 支持 `image/source/base64/media_type`；Codex App Server 支持 `localImage`，公开源码将其转为图像 data URL。 | 两者是结构化会话输入能力，不能推断可以向现有 PTY 塞同样 JSON；不自动更换 WillYou 中央终端架构。本轮没有真实 CLI 接收证据。 |

官方依据：[PDF 包固定源码及依赖](https://github.com/modelcontextprotocol/ext-apps/blob/82221c0c8ce7661efa6771c9d461511b1650495f/examples/pdf-server/package.json)、[PDF server 源码](https://github.com/modelcontextprotocol/ext-apps/blob/82221c0c8ce7661efa6771c9d461511b1650495f/examples/pdf-server/server.ts#L722)、[Claude 图片输入方式](https://code.claude.com/docs/en/common-workflows#work-with-images)、[Claude SDK 图像消息](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)、[Codex App Server 输入](https://learn.chatgpt.com/docs/app-server)、[Codex 公开图像类型](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/user_input.rs#L25)。最后两项仅查询公开资料，没有查看、启动或附加本机 Codex。

## Viewer 适配结论

MCP Apps 是 **Tool + UI Resource**：工具 `_meta.ui.resourceUri` 指向 `ui://` HTML，宿主加载隔离 iframe，并转发白名单 app-only 工具调用。资源能力只是必要条件。R3 的“不请求 tools/list”仅能描述当时 REA resources-only 探针；不可泛化为 MCP Apps 永久禁令。后续需有界发现（分页/响应上限/超时）及显式适配清单，而非无差别加载全部工具。[官方快速入门](https://apps.extensions.modelcontextprotocol.io/api/documents/quickstart.html)、[固定版扩展规范](https://github.com/modelcontextprotocol/ext-apps/blob/82221c0c8ce7661efa6771c9d461511b1650495f/specification/draft/apps.mdx)

候选示例的本地读取在 `server.ts:722–752`，UI 资源注册在 `2757–2788`，`save_pdf` 在 `2733–2742` 直接写文件；它不是 M9 的 ifMatch/原子写回。示例目录判定还接受 lexical 子路径，不能当作 M9 root lease/symlink 防逃逸证明。此次实验限定**合成 fixture 只读**，不启用保存、不读取真实项目、不允许字体 CDN 或其它外联。正式接入仍需可信文件身份、main broker、版本冲突、取消/失效回执、资源生命周期和隔离宿主；写回继续沿用自定义 ifMatch 方案及已有实验，不能把示例直接写磁盘当通过。

官方 [basic-host](https://github.com/modelcontextprotocol/ext-apps/blob/82221c0c8ce7661efa6771c9d461511b1650495f/examples/basic-host/README.md) 提供双 iframe 参考宿主；UI 不依赖发模型请求才能加载。应拒绝示例的模型上下文更新/发消息与非白名单工具请求。

## 固定版本与隔离运行入口

本机 Node `v22.23.1` 满足官方 `>=20`。npm 包本体解包 **7,366,474 bytes**；10 项直接依赖，隔离安装实际新增105包。安装时目录约111MiB、缓存65MiB；最终 `du -sm` 为目录110MiB、缓存64MiB，低于500MiB限额。PDF.js `5.4.530`、`@cantoo/pdf-lib` `2.6.5`、MCP client/server `2.0.0`、ext-apps `2.0.3`。精确传递依赖见 [锁文件](r34-provider-package-lock.json)，[安装日志](r34-provider-install.log)；来源、脚本及证据哈希见 [sources.json](r34-provider-capability-sources.json)。

以下安装已执行，实际运行由下方验证脚本包裹 macOS 只读/禁网沙箱；裸启动命令只说明官方入口，不应跳过隔离直接执行：

```sh
npm install --prefix /private/tmp/m9-r34-provider --cache /private/tmp/m9-r34-provider-npm-cache --ignore-scripts --omit=optional --no-audit --no-fund --save-exact @modelcontextprotocol/server-pdf@2.0.3
node /private/tmp/m9-r34-provider/node_modules/@modelcontextprotocol/server-pdf/dist/index.js --stdio /private/tmp/m9-r34-provider/fixture/example.pdf
```

stdio 入口适合自有隔离 MCP 宿主；官方 HTTP 入口读取 `PORT`（默认3001），basic-host 读取 `HOST_PORT`、`SANDBOX_PORT`、`SERVERS`，不可占用用户既有服务。完整原版 basic-host 的 `npm run start` 会先构建并使用 Bun 启动 `serve.ts`；未确认 Bun/端口前不得声称可直接运行。若采用小型测试宿主，其身份须明确，实际 viewer HTML/字节读取必须来自官方包，不可用自制 PDF 页面替代第三方 viewer。

## CLI 图像载荷接续

继续保留 V05/V06：按受支持运行时实现独立图片附件适配，先由 main 校验 file identity、MIME/尺寸/大小并绑定任务、PTY 和源版本；图像解码失败明确报错，不静默改为路径成功。原生 clipboard 路线须保持用户自行提交，处理剪贴板并发、取消/任务切换、接收证据与恢复。结构化 SDK 路线仅用于相应会话能力，不能据此擅自切换现有终端架构。

隔离自建终端/剪贴板接收方可以验证 bytes/MIME/hash 和无 Enter、失效/取消等前半段；**不能证明真实 Claude/Codex 接收或 V05/V06 通过**，本轮不为此增加伪闭环测试。R05.14 的普通文件拖放（图片同样）继续只插完整路径，和真正图片附件保持独立。

## 实际执行与结果

运行 [验证脚本](r34-provider-viewer-check.mjs)：`node docs/里程碑/M9_文件浏览工作区/验收/证据/r34-provider-viewer-check.mjs /private/tmp/m9-r34-provider`。前置为上述固定依赖、既有 `/private/tmp/m9-qa` Playwright、本机 Chrome 与已归档合成 TeX PDF；脚本还复用固定 commit 的 `examples/basic-host/src/sandbox.ts`（下载至临时 `reference/`，URL及哈希已记录）。本轮没有改生产代码、原型业务代码或正式验收用例。

环境为 macOS arm64、Node22.23.1、Chrome155.0.8059.80。真实官方服务通过 stdio 连接；宿主是独立研究脚本，桥接使用官方 AppBridge/官方双 iframe sandbox 源码，实际查看器 HTML 与 PDF 范围读取均来自官方发布包。宿主仅覆盖结果元数据 `writable=false/interactEnabled=false`，关闭保存与命令轮询；**未修改官方 HTML 或用自建 PDF 页面替代它**。

| 核对项 | 实际结果 |
| --- | --- |
| 官方资源身份 | `ui://pdf-viewer/mcp-app.html`；4,305,806 bytes；SHA256 `3c8aa8ca4d27bf20429b8b3a8dd6521340594cc1c1cbf69f50e3d35908625be7`，与包内 HTML 完全一致 |
| 文件身份与显示 | 合成两页 PDF 4479 bytes，服务实际返回字节的 hash 与磁盘一致；官方 PDF.js 绘制612×792非空画布，可见 `Hello WillYou.` 和 `Authorized local include.`；本轮只验第一页显示 |
| 拒绝与隔离 | OS拒绝写fixture、读根外canary、连接回环网络；服务拒绝非白名单文件。测试宿主仅转发 exact fixture 的 `read_pdf_bytes`，保存调用返回403；frame无法访问宿主DOM |
| 外联与模型 | 浏览器外部请求/响应均0；CSP不允许字体CDN。两次模型上下文更新被宿主明确拒绝，没有模型请求；不是全部console无错误 |
| 卸载与清理 | 官方 teardown确认、移除iframe、随后400ms无新provider调用；浏览器关闭、stdio子PID退出、自有两个回环监听关闭。没有验证长时泄漏、所有Worker退出事件或恶意旧frame消息 |

最终 [运行JSON：18/18](r34-provider-viewer-report.json)、[官方服务日志](r34-provider-viewer-server.log)、[浅色截图](r34-provider-viewer-light.png)、[深色截图](r34-provider-viewer-dark.png)。主题截图仅记录此合成页面，不代表完整主题一致性验收。

失败过程保留：首次Node入口被沙箱拒绝路径祖先 `lstat`（[JSON](r34-provider-viewer-initial-failure.json)、[日志](r34-provider-viewer-initial-server.log)），通过仅补祖先元数据并把cwd放到准许包路径解决；首次浏览器运行的 CSP 未允许官方包内data-URL Worker，8/9（[记录](r34-provider-viewer-first-browser-failure.json)），补允许data/blob脚本而仍阻断外联；随后测试脚本对0尺寸备用canvas调用getImageData，8/9（[记录](r34-provider-viewer-probe-canvas-failure.json)），修正探针后18/18。不能将这些历史失败抹去。

官方包版本为2.0.3，但握手 `serverInfo.version` 为2.0.0；按实际分别记录。省略optional canvas包使服务stderr有 `@napi-rs/canvas` 缺失警告，当前PDF范围读取/浏览器渲染成功，不证明服务端截图等其它功能。浏览器对 `allow-scripts + allow-same-origin` 有通用警告：本次使用不同origin的外层代理，动态宿主DOM隔离检查通过；不是完整沙箱攻击审计。保存403和模型上下文拒绝为预期负测。

结论：**GAP-07已补上“真实第三方供应存在且能在受限本机环境显示文件”的证据**；M9正式隔离宿主、配置发现/文件授权、订阅恢复、ifMatch写回、CLI真实图像载荷仍需各自工程接续。本轮没有安装/启动用户CLI、发模型请求、读凭据或操作Codex。临时依赖/缓存保留供复验，无全局安装；所有本轮运行的服务与浏览器已关闭。
