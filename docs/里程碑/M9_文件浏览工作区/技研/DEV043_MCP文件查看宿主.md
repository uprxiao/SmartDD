# DEV043 本机 MCP 文件查看宿主

2026-10-18；依据 R3.4 的 R06.15/R06.18/R07.13、开发前 07、F28/J12/S06/S07/Y30。用户本期完整开发授权持续有效；本文件细化既有范围，不增加网络文件库、模型调用或自动下载服务。实现与验收进行中，不能将本方案视为通过结果。

## 生产接口与权限

- `file-viewer.ts` 定义显式适配清单、来源/后缀、偏好与会话请求。普通 AI 配置中的 MCP 注入不会自动成为查看器。配置登记界面由可信 App 提供；扩展不能登记自身或更改配置。无注册、无 resources、断开分别显示原因并可返回原查看器。
- 已登记的 `local-resource` 适配器使用官方 SDK Client/Server 的真实资源协议，进程内 transport；它是 WillYou 自己提供的本机适配器，读取、草稿与自定义 ifMatch 写回最终调用 FileService / native broker，复用根 fd、原子事务、持久 opId 和恢复链。该适配器不是任意第三方 MCP 服务皆可写的承诺。
- 已登记 stdio provider 使用官方 SDK 2.0.0。命令/参数/只读运行资源必须在适配清单中明确列出；进程仅获得私有快照，不获得真实项目路径、环境凭据或网络。macOS OS sandbox 不可建立则拒绝启动，不能退为无沙箱。外部 Apps 适配器为只读，其不满足自定义写回契约时没有保存入口。
- 会话键绑定可信主 frame 的 owner、FileRef、root generation、随机 session id、精确资源 URI。读取/写入/工具调用均再次检查；URI 不规范化、不忽略 fragment、不做前缀放行。切 tab/关闭/根失效取消在途请求并注销会话，迟到回包不更新新会话。
- 普通 resources 适配器不做 tools/list。Apps 需要明确 UI URI、初始工具与固定参数的 app-only 只读工具白名单；逐页发现最多 8 页/1 MiB/15 秒，核对工具→UI 关联及只读声明。renderer 不能提供任意 tool args、模型消息、任意资源 URI或新进程命令。

## UI 隔离与保存

使用独立 `WebContentsView` 和非持久 Electron session。可信 data 文档的窄 preload 仅转发当前 UI 协议；不可信 HTML 仅进入 `sandbox=allow-scripts` 的 opaque blob 子框，无法读可信外框、主 App、Node 或 preload。CSP、导航/弹窗/下载/文件选择拦截、权限拒绝共同限制来源；主 App CSP 不放宽。AppBridge 使用空 MCP client，逐个注册当前资源/只读白名单处理器。子框 source/origin、主进程 sender/mainFrame、owner/id/URI/generation 和源会话有效性逐层核对。UI HTML 上限仍按解码真实字节，不信服务器声明的 size。

网络隔离在创建/加载视图之前等待固定不可用代理建立，HTTP/HTTPS/SOCKS 均无 DIRECT fallback，并移除 Chromium loopback bypass；配合 `disable_non_proxied_udp`。该 WebRTC policy 单独不是禁网证明。真实接收器正/负对照见后附证据。关闭后串行清理 storage/cache/connections；下一次打开必须等待所有前序清理，最多 4 个隔离 session 并复用空闲槽。

本机可编辑资源走自定义 `willyou_write_resource_if_match`：精确 URI/generation/opId/version/ifMatch/bytes。只有 native `saved` 回执更新 etag；conflict/unknown/too-large/failed 保留编辑和草稿。重复 opId 同载荷复用既有持久回执、变载荷拒绝。临时 adapter 的退出/超时不能使草稿变为已保存。第三方 Apps 仅转发明确只读工具。

## 限额与生命周期

资源 20 MiB；stdio frame 为 `ceil(20MiB/3)*4 + 256KiB`；单请求 15 秒；最多 4 会话；通知每秒 200 条，超量计数，订阅通知只置失效状态，显式重读才更新 bytes/etag。非 JSON/超帧/进程退出使当前会话失败并取消在途请求。关闭取消订阅、终止自有连接、清理原生视图/子框与私有快照。资源来源撤销与窗口导航均关闭会话。UI 入站消息上限 256 KiB、合计在途资源/工具请求最多 8 条；出站资源仍有 20 MiB 字节预算。UI 初始化 15 秒计至 initialized 通知；每 2 秒对 frame 子树发送静态常量心跳，连续 5 秒不响应或子树进程内存合计超 512 MiB 时终止视图，不把 opaque OOPIF 漏在外框心跳之外。

## 原型与验证增量

原有 P17 仅“扩展查看器（模拟）”按钮改为同一登记/默认/显式选择与资源状态交互；原型保持合成数据、清楚标注模拟，不运行 MCP 服务。生产新增独立 mcp 模块，只在文件菜单和内容分派接入，不改变文本输入管线。所有 prototype 变化保留 DEV041 输入中断行为。

F28/J12 的 U/I 将通过生产注册入口、真实 SDK 协议以及真实 FileService/native 磁盘链执行。外部 stdio 分支使用隔离 fixture server；记录进程、URI、资源 bytes、保存前后 hash 与恢复材料。Apps/UI 实际隔离、真实包及 S06/S07/Y30 的 A 层单独记录，不把服务测试称为 App 端到端。

## 来源与边界

官方 `@modelcontextprotocol/client@2.0.0`、`server@2.0.0`、`ext-apps@2.0.3`（MIT），固定版本沿用已取证 R3.4 实验；依赖从公开 npm 安装且禁用安装脚本。公开协议参考：[TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)、[MCP Apps](https://github.com/modelcontextprotocol/ext-apps)。本机原临时实验 node_modules 已不存在；不把旧运行环境当本次证据。最终 NOTICE/许可/依赖快照随实现归档。

### 2026-10-18 实施中检查点

- 主进程生产入口已接 FileService 的 `viewers`，配置由 `SettingsStore.fileViewers` 保存；条件保存复用原有 FileBuffer → controller → MCP 自定义 ifMatch 工具 → FileService → 原生事务，不创建第二套落盘路径。
- 外部 stdio 本机隔离实测文本/blob、精确URI、实际字节上限、禁止越界读/写快照/子进程/loopback连接；Apps tools/list 只在声明 resources 与已登记 Apps 时触发，app-only只读工具及固定参数/数值范围单独核对。
- 原型 P17 新增 `FileMcpViewer.jsx`：登记校验、自动/显式选择、内置回退、条件保存/冲突/断开合成状态，草稿沿用工作区原有状态；仅公开合成数据，不连接实际 provider。
- 早期外部 HTML 的双 opaque iframe/CSP 不能作为 WebRTC 网络隔离的完整证据；该检查点现由下述独立 session 实现及实际网络对照补充。旧包 r6 仍是旧实现，不能沿用新宿主结论。


### 2026-10-18 r6 后独立宿主验证

- 入口 `scripts/files/mcp-ui/launch.mjs` 把当前生产模块编译到新建 `/tmp`，在隐藏的独立 Electron 中运行。测试不是已有 App 的脚本操作，也不以它替代打包 App 的 A 层。实际链为 FileService → 已验 native broker → 明确登记的 sandboxed stdio provider → 公开 App SDK → 生产 AppBridge → 窄 IPC → 独立 WebContentsView。
- 七组集成通过：初始化 input 先于 result、当前资源原字节与限定 tool、七类越权拒绝；owner/URI/generation 拒绝；关闭前/初始化中取消；受控延迟的真实 cleanup 串行屏障；跨 owner 清空 cookie 并复用槽、几何裁剪/源撤销；200/s 消息预算；实际 15 秒初始化超时/重开；opaque 子框死循环约 7 秒终止而父窗口存活。前后 11 项源哈希一致、fixture SHA256/inode/mtime 不变。
- 独立网络正对照即使带 CSP connect-src none，仍收到 STUN UDP 5、TURN TCP 1、TURN TLS 目标 TCP 连接 2；固定代理与 WebRTC policy 组合后均为 0，resolveProxy 明确不是 DIRECT。最终生产 native UI 另实测三项均为 0。TLS 目标只统计 TCP 连接，不宣称验证 TLS 握手或远端网络。
- 保留初始测试构建器漏外置原生 watcher、fixture 语法/边界断言、bundle require 垫片误判等失败；同时保留真实发现的 cleanup 逆序风险和只探外框漏掉 OOPIF 死循环的红测。修复不放宽权限或篡改用例分母。
- 定向回归及真实 SQLite 登记/原生条件保存链保留；删除未再被生产使用的旧 iframe sandbox helper 与其单测，旧证据作为历史保留。新增 bridge 并发/React cleanup/IPC sender 测试明确分别为 U 层，不能冒充实际 native 或 App UI。
- S06/S07/Y30 的 U/I 证据可供正式 A 层复用；打包后的浅/深色显示、遮挡与恢复焦点、用户文件选择/拖入拒绝、切 tab 后视觉恢复仍待主流程验收，当前不判整条通过。

参考：[Electron proxy 配置](https://www.electronjs.org/docs/latest/api/structures/proxy-config)、[WebRTC IP policy](https://www.electronjs.org/docs/latest/api/web-contents#contentssetwebrtciphandlingpolicypolicy)、[RFC 8828 §5.2 Mode 4](https://www.rfc-editor.org/rfc/rfc8828.html#section-5.2)、[WebFrameMain 子树与进程 API](https://www.electronjs.org/docs/latest/api/web-frame-main)。这些来源解释实现依据；实际结果以上述独立证据为准。

- 输入守卫补验：当前实际 SDK 子框内 file click/label 转发、文件 paste、固定 picker 方法，以及篡改 type/composedPath/preventDefault 后的拒绝均通过；文本 paste 保留。该 JS guard 为叠加防护，不单独证明所有系统 chooser 路径；主 target 的原生拦截是否覆盖 opaque OOPIF 尚未执行系统触发验收，不能将合成事件写成该分支通过。
