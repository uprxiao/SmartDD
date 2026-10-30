# DEV115 Markdown 事件与选区生命周期（本批X12已完成）

依据R3.4-P1/R06.2/R08.7，接续DEV114正式223/419。优先核查X12，关联X03/X07的选择显露保持未执行，不能将一部分通过外推为三条完成。419范围/预期不变，不发布。

## 开工核查事实（修复前）

- 生产markdown/editor.ts的链接click仅检查DOM lifetime和item revision，尚未按X12核对普通左键、Shift/多击及非空文字选区条件；共享原型FileMarkdown htmlClick也缺此矩阵。
- 生产mousedown即时preventDefault并显露整块，当前没有拖动期间延迟选择回调的统一owner。没有旧document mouseup监听不等于拖选/中途关闭行为已实现；须连同X03源映射核对，不能用“零监听”冒充完整通过。
- 当前每块Widget AbortController及alive范围校验可复用。DOMSourcePoint/sourceRange为权威UTF-16偏移入口，禁止从预览HTML反序列化成文件。源模型、数学/图表已验收的断开保护与独立Worker必须保留。
- R沿用已归档M01/M02及现行用例，禁止绕过Codex工具拒绝获取新实机资料；未有动态像素证据如实保留。P与实际App分别执行，P不作A。

## 接续工作

1. 先用真实CM/当前Worker I写有判定价值的事件红测：左键/Shift/多击/非空选区、相对文件/外链入口、空白双击、拖动未mouseup关闭和切换。记录确切selection归属及旧回调是否触及新view，不能仅检查HTML相等。
2. 依据红测实现共享事件guard、每view/DOM拖选owner和可取消mouseup/abort清理；先确定与X03/X07细粒度源显露的必要边界，不扩大业务范围。相对文件仍经真实可信根解析；外链不得获得任意文件RPC。
3. 同步共享原型，执行实际浅/深P与受影响模型；生产代码稳定后完成相关测试/类型、打包，串行实际App验收。现有r65不可证明后续生产修改。
4. 用户离席期间不打开外部账号/服务/模型或请求重复权限；若外链真实入口需要用户/外部程序，保留具体边界，继续其余测试。最终仅按完整层级和原预期更新正式用例。

## 开工状态（历史）

目前为读取与缺口核查，尚无DEV115红测/实现/构建或通过结果。已完成的DEV114证据和223/419事实不回退或改写；当前包r65/ASAR 2797a14e48b6e7eb50fe213dfce28fe1e126d34e6d2d14e4e862c98376efe293，仅供已验收基线。下一步从事件I红测开始。


## 代码及原型结果（历史阶段记录）

初次9项真实native/当前Worker/CM I为2通过7失败，直接复现Shift、多击、右/中键、非空CM选区误触发链接及未建立mouseup owner。补齐共享guard和document mouseup取消；保留按下时的native/source选区判断，避免默认聚焦/blur先折叠后误导航。加入原生文本范围到源码、docChanged取消和native选区先折叠三项，最终新增12 I。182相关代码及4安全专项分开全部通过（均零失败/跳过/Unhandled），历史代码并集待本批收口再更新。候选普通sandbox下2项native watcher在fixture注册前等不到watchRegistered；原样在获准本机环境运行全部51个native I通过，未改超时或断言。候选中4项安全opt-in先跳过，随后明确开启原packaged broker后4项单独通过，最终相关代码182报告已排除该独立专项以免混淆。类型检查的测试清理delete类型修正为Reflect.deleteProperty后通过。

P首轮16项真实浅深色浏览器检查通过；补选区点击前blur保护后最终18项通过（真实键盘选择Tail再点击链接无导航），原生document监听转发记录保持原函数identity。关闭/切换在鼠标未释放时通过Tab/Enter真实操作，再放行原生mouseUp，旧监听已移除。原型241模型/构建/Sites4通过。P为合成页面/回调，不替代真实文件业务。新包r66源码已冻结1108，SHA f44b3ce514c1cf2fc97de1465c74f849999e8de347110c96ac9f94b5f9dbe1c8；首次pnpm多余--参数预检失败尚未构建，修正转发参数后正在真实打包。App尚未执行，本条X12与正式223/419保持不变。


## 最终结果与边界

X12完整通过，正式224/419（53.46%），X03/X07仍未完成。最终代码182＋独立安全4、P241/构建/Sites4/P18、r66 App10及同包实际数学13全部通过，均无失败/跳过/Unhandled。R以本阶段已确认M01/M02及保留trace事实核对，不补称缺失原模块或新Codex动态证据；源码显露更细的范围继续留在X03/X07。

App通过真实原RPC/可信根打开相对文件；外链执行原sender/URL验证后在OS shell边界明确reject，记录实参，验证入口/失败处理/无文件RPC，不宣称外部浏览器启动。真实键盘选择Tail后点击链接不导航；空白多击回权威source。选区拖动未mouseup时，通过真实Tab/Enter关闭或切标签（不写DOM focus/selection），待新编辑器就绪才原生mouseReleased。原native listener函数identity在关闭前确实注册，关闭后原mouseup前已不在原生表，Other source/anchor/head保持。

一次Base UI菜单监听用once/signal自动注销，普通JS remove计数看不到原生自动删除，先前“残留”是测量误判。最终[DOMDebugger.getEventListeners](https://chromedevtools.github.io/devtools-protocol/tot/DOMDebugger/#method-getEventListeners)取得浏览器实际注册表，再以Runtime.callFunctionOn纯读取与观察到的原函数identity对照；全部文件视图关闭后的真实document mouseup为0。原型旧观察器是相同的原生转发，后续只增强App诊断，不改P组件或业务。所有观察器/IPC/shell恢复，三App与P正常退出0、文件未改/进程关闭。

首次App输入按UTF16计数移动箭头会在emoji/atomic块越界；改真实字符点/Home/Shift，不改Tail预期或产品。诊断模板转义失败改函数序列化。一次pnpm多余--使解析参数提前退出，修正命令后成功；失败历史均保留。[90项不可覆盖证据](../验收/证据/m9-acceptance-markdown-events-dev115-r66-20261019.json)，报告SHA 887386e0d81a241948d13eb3e54fe231c82201fcd210c8906e813efa0d6c6378。1108构建源SHA f44b3ce514c1cf2fc97de1465c74f849999e8de347110c96ac9f94b5f9dbe1c8，1108实测源SHA 6cf5711f520922a654c8454b3d68028220ff2422ea2f6f598cf07d7ef793d8cc；构建后只有两个外部测试文件变化，src/native输入无改。r66 ASAR a13d0d70f7ff74d30c3b38d9275ae3f23565936b3a03ab4a221a8d2be2c09d07，六native smoke与82运行文件一致。开发分支0.0.5未发布，完整419目标及系统/参考/平台限制继续。
