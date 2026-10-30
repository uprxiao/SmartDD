# HTML 文档正式接入

2026-10-17；依据 R3.4/R3.4-P1 R06.13/R06.16/R08，关联 F24/G11/K07。生产宿主、文件接口及界面已接入，原批70项相关单元/集成测试通过；真实App已有部分开发检查及两项缺陷，完整用例未通过。Notebook HTML继续原有禁脚本策略，不使用本宿主。

## 实现决策

普通HTML/HTM默认源码，显式“查看文档”才创建独立`WebContentsView`；源码权威缓冲、保存/冲突逻辑继续复用，不把渲染后的DOM回写成HTML。文档不提供地址栏、浏览历史或任意导航。`WebContentsView`是Electron原生子视图，适合在文件区域承载单独WebContents。[官方API](https://www.electronjs.org/docs/latest/api/web-contents-view)

每次文档预览使用随机origin；每个可信窗口拥有专用无`persist:`前缀的内存session，复用前等待上一文档的存储/缓存/连接清理，关闭时释放view和资源映射。无Node、主App preload或应用RPC；独立`m9-html-guard` preload只在隔离世界拦截文件拖入/粘贴，不向页面暴露接口。权限、弹窗、下载、导航、子frame和任意网络请求均设拒绝；只有已登记本地资源的专用协议能读取。原型继续合成内容，不访问磁盘。[session隔离](https://www.electronjs.org/docs/latest/api/session)、[Electron安全指南](https://www.electronjs.org/docs/latest/tutorial/security)

文档脚本可在该宿主运行；响应头CSP独立禁止connect/frame/object/form/base/worker，禁止eval，仅允许内联脚本和已登记的本地脚本。文档不会获得主窗口对象，资源URL也不是任意路径代理。UI内菜单/对话框遮挡时隐藏原生子视图，避免它盖住应用菜单；尺寸按实际文件内容区域更新，并由主进程裁剪到窗口内部。此项须真实App复验。

## 资源与生命周期预算（实现前冻结）

- 源文档≤10 MiB UTF-8且≤5,000,000 UTF-16码元；字符超限可继续源码查看，超过文本读取20 MiB的文件遵循既有源码门槛。
- 本地资源经HTML/CSS静态引用映射，不执行项目命令、不联网获取依赖。只登记允许的脚本、样式、字体、图片/媒体类型；路径归一化并由原生FD根边界再次核验。未登记资源明确不可用，不自动扩大授权。
- 单文档最多128个资源、每资源≤8 MiB、合计≤40 MiB，依赖深度≤8；每窗口最多一个活动文档宿主。超预算/缺资源/解析异常明确记录并保留源码入口，不静默称完整预览。
- 读取、建立及加载15秒超时；取消、文档/根变化、标签切换或窗口退出释放在途读与文档进程。出现无响应/崩溃时返回可重试状态，不能阻塞主界面。
- 全应用最多4个活动文档；单宿主最多512次请求、8个响应流、64 KiB输出块并启用背压。每2秒检查进程工作集，>512 MiB时停止；隔离世界静态心跳连续5秒未返回则终止。此为观测式预算，不能当作OS硬内存限制。

这些是工程预算，不是Codex动态测得值。HTML用parse5 SAX、CSS用PostCSS/value-parser、模块引用用es-module-lexer纯JS入口；它们在128 MiB Node Worker解析，不执行项目脚本。静态与字面量动态模块导入已映射，变量生成路径不映射并报告，不能用任意同目录代理代替。真实DOM、资源请求、浏览器权限（含文件选择/拖入）、WebRTC、菜单遮挡与销毁验证仍待执行。

## 接续

生产源码：`src/main/core/files/html/`、`src/shared/file-html.ts`、`src/renderer/features/files/html/`；文件FD绑定在`file-service.ts::htmlSource`，RPC只接受可信应用主frame。普通HTML默认源码，进入文档前复用保存/冲突门禁；切回源码销毁独立宿主。主界面从不接收项目HTML字符串用于执行。

本批70/70：5项解析/图、4项协议/CSP/流/尺寸、4项宿主生命周期、1项实际Node Worker、3项React桥接、51项原生文件边界、2项RPC边界。Electron宿主及React测试使用明确隔离的API替身，原生FD/解析Worker为实际实现；不能代替真实App。调整加载超时强制终止后，宿主4项另复验通过。`pnpm typecheck`、原型build/prepare通过。

14个原批合成夹具已放在隔离项目`html-cases/`，后补文件输入样本。实际App已显示CSS、内联脚本、中文模块/SVG和点击计数，但发现M9-DEV-008菜单焦点/恢复空白和M9-DEV-009普通文件选择器仍可打开。系统`showOpenFilePicker`拒绝不代表普通input也已拒绝。完整资源/权限/大小/生命周期矩阵继续，当前F24/G11/K07不计通过。

普通文件选择器由Chromium原生边界拦截，固定命令不暴露为RPC。先加载可信空页，启用`Page.enable`再设置`Page.setInterceptFileChooserDialog {enabled:true,cancel:true}`，加载项目页面后再次确认；保护失效或preload失败则关闭预览。原r2/r3只设拦截而未启用Page，真实包仍弹出系统选择器；Chromium源码显示`enable`才注册instrumenting agent，不能用命令成功回执代替实测。[Page实现](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/inspector/inspector_page_agent.cc)、[协议定义](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Page.pdl)

菜单隐藏子视图时还须把键盘焦点交回主WebContents；系统sheet、最小化和非活动窗口不抢焦点。已补生命周期回归，退出动画结束、隐藏/inert祖先也参与遮挡判断。r4已移除临时诊断UI，真实包复验普通/键盘/动态/showPicker均未弹出选择器；菜单焦点交回、Escape关闭后文档实际恢复。网络/file fetch、WebSocket、Worker、popup及独立parent也由合成文档实际检查；无限脚本终止后重新加载成功。外部拖入/粘贴、导航、资源/边界完整矩阵继续。各包哈希与结果保留在[开发证据](../验收/证据/m9-development-html-ui-20261017.json)。

r4边界开发检查分别观察到5,000,001 UTF-16码元（仍小于10MiB）与10MiB+1字节（仍小于5M码元）被拒绝，源码入口保留；后者首轮暴露底层英文错误，已补中文10MiB说明并通过5项相关测试，待后续包复验。等于边界及其他来源路由尚未据此填通过。

### 2026-10-18 F24/G11 r20 完整 I/A 接续

以上为早期开发记录。本批普通HTML/HTM两条真实树入口完成默认源码首尾、显式文档、经典/模块脚本、嵌套CSS/PNG、计数按钮、源码返回及原生子视图销毁。文件与受控根外哨兵的bytes/身份不变，图片64×32及CSS实际值核对，独立文档截图已目视。

实际隔离宿主window.origin和postMessage事件origin为null，parent===self、opener为空，electronAPI/require/process/Buffer/ipcRenderer均undefined；伪造应用消息留在文档自身，主窗口未收到，脚本标记未进入主DOM。fetch/XHR/WebSocket/Worker/eval/storage均被阻止，弹窗无新增page target，本地和外部导航均保持原URL，回环陷阱零请求，指向受控根外的脚本未执行。没有新增地址栏/历史浏览器工具。

24项现有相关代码回归通过，包含真实解析Worker、资源图、协议/CSP、origin/frame/webContents/权限/导航/取消和renderer桥接；Electron/session与部分资源源为明确替身，不能替代实际App。另两组真实公开IPC读取核对完整SHA、错误baseHash拒绝、关闭ref拒读，分别记I。本批无生产变更，原r20 ASAR及81运行文件保持；894源文件快照SHA 480e701d8cf37bd937c4ec130294cd982d5446020992198b1320ddd6d76b3d35，仅新增两个外部验收脚本，不重复打包。

第一轮探针在UI roots初始化时主动调用files.roots，按正式续签契约撤销了UI租约，导致CANCELLED；将直接IPC I放到完整App流程结束后通过，不改正式撤销规则，不记产品缺陷。[本批证据](../验收/证据/m9-acceptance-html-r20-20261018.json)保留两轮驱动/夹具/失败及通过。无新原型设计或P/V结论；K07附件/custom loadText、文件选择器/物理焦点/粘贴/长期资源等仍依各自用例，不由F24/G11代替。仅macOS arm64，未发布。
