# DEV124 资源URL归属与撤销

依据R3.4/R3.4-P1、M11（R06.4/R06.5/R08.7）的原I/A，正式 **233/419（55.61%）**，余186（184未执行、2阻塞），183含App。阶段仍开发中，无发布。

## 实际缺陷与方案

正常r71的同session第二真实BrowserWindow、同App file地址、无preload/node且原IPC鉴权不改，仍可解码原普通图像Blob并读到完全相同RGBA哈希，形成M9-DEV124-BLOB-OWNER红测。最早fetch probe被原CSP阻断，不能据此当跨窗口保护通过；之后用实际Image解码/canvas才证实缺陷。两轮日志/结果保留，最早probe源码未单独冻结，不补造历史版本。

[资源服务](../../../../src/main/core/files/resource-service.ts)复用[原媒体token/range/stream](../../../../src/main/core/files/media-service.ts)。普通图像/SVG和PDF文件输入使用willyou-resource随机32byte token、原controller owner、不可变revision及活动预览/文档/根/窗口生命周期；URL不含磁盘path/query，主/native保留40MiB图像和256MiBPDF边界、1MiB分块，每owner4grant/每grant4reader。生命周期结束撤销，不声称新增独立墙钟TTL。协议不可用时图像/PDF失败关闭，无共享Blob回退；既有媒体binary回退保留。

[网络门控](../../../../src/main/core/files/viewer-assets.ts)以真实webContents/mainFrame的id/processId/routingId比较controller owner，其他窗口/子frame/无frame在IO前拒绝。Electron[WebRequest文档](https://www.electronjs.org/docs/latest/api/web-request)说明只保留最后一个listener，因此默认session组合媒体/资源两个scheme；HTML与diagram已有独立partition，未覆盖其隔离。使用本机Electron42的实际frame，不假设后续initiatorOrigin字段。[协议注册](https://www.electronjs.org/docs/latest/api/protocol)不开CSP绕过、任意file://服务或HTTP读盘代理。CORS头允许合法owner文件页fetch，授权仍由前置frame门控承担。

[图像呈现](../../../../src/renderer/features/files/workspace-panel.tsx)直接用受控URL，[PDF输入](../../../../src/renderer/features/files/preview-resource.ts)有界读完整响应、验长度/hash，再交给原pdf.js worker字节，不让引擎接收文档自带URL。no-store防旧缓存；原图片/PDF、源码、错误/重试、布局样式不变。

## 证据及保留失败

[新I四项](../../../../src/main/core/files/resource-url-acceptance.test.ts)：真实SQLite/source/controller/FileService与包内native，明确合成sender身份；PNG/SVG/PDF foreign ref在IO前拒、伪URL不IO、owner字节准确、wrong-owner release无效果，关原consumer不影响peer，owner/根关闭后计数零；实际外改旧revision410不返回字节。新U22，加前批核心17/native59、PDF21及媒体/协议等，当前去重129零失败/跳过/Unhandled，类型检查通过。

[A驱动](../../../../scripts/files/resource-url-ui.mjs)和[被动原IPC观察器](../../../../scripts/lib/file-resource-observer.mjs)：正常r72浅深×PNG/SVG/PDF6组；真实UI开关重开，程序式URL互传是本条攻击输入，不使用系统剪贴板。第二真实窗口与主窗口共享session及App地址，但无preload/node/bridge，原鉴权不改。原/新URL共12次owner读取精确源hash，peer拒，24伪地址拒，关后owner/peer旧URL拒，重开新token且旧仍无效。原source/outside指纹保持、原IPC输入/回包前后hash相同并恢复；peer销毁，主App退出0/null。

受影响App回归56：M04正常12、PDF9变体加导航/关闭恢复、媒体15、栅格18（实际GIF合成器帧/透明像素/解码失败）、恶意SVG浅深2（真实源码往返、无脚本/DOM注入/自建回环请求）。加M11新6共62数组检查，PDF导航恢复另记。PDF/媒体/栅格旧驱动是harness清理，不能冒充正常退出；M11/M04/SVG三当前run及两个早期probe有显式正常退出。已知PID和自有bundle/helper/native前缀全关闭，无默认浏览器、外部App、模型、日常凭据或Store/editor/DOM值注入。

保留早期policy13过2失败：标准Request构造器已拒credentials URL，仍验证allows拒绝，并将构造阶段拒绝单列，未放宽规则。deferred Buffer测试泛型引发类型失败，仅改测试声明后通过。查看浅色PDF截图，非完整参考像素验证。

## 基线、限制与下一步

r72 macOS arm64内部0.0.5，ASAR81fcc9dc55b069070d48e33007a09b2cc461fbf2e3ffaed011ac14198a9ffb99；broker/watcher源与哈希不变。1171构建tar SHAa02dfea7dae0ba31037d410cb48a9e8d9db31a342489d34b536c21e84ad205af；1171实测tar SHA5275e9a0a8d0e9c923a60e2953902d20f20e0f3df694ec11622d16a1c8b4a1f9。旧1163中1154不变，9改/8新；构建后只有A驱动和I用例补SVG，生产一致。六smoke/82运行新核对；P代码样式零变，旧P243/共享核心16/构建/Sites4不是本批新全套。

[189项证据](../验收/证据/m9-acceptance-resource-url-dev124-r72-20261019.json)，报告SHA1fc37b4ccabe1513a132329d691827ec1a517555b41798365fb1b4d290d5d17e，前批148项不变。仅合成样本/DTO/日志/截图/源码入库，无userData/数据库/整包。其他嵌入式Markdown/Notebook/diagram图像还有各自数据/Blob路径，普通文件资源URL的结果不外推这些路径，后续专项审计不能遗漏；也不外推系统/物理IME/其他平台或完整Codex像素。继续M05大小写/realpath别名、H20条件、X03精确R及其他约定项。全部419仍要求完成。
