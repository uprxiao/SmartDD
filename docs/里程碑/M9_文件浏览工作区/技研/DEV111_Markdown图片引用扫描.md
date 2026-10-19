# DEV111 Markdown 图片引用扫描

依据R3.4-P1/R06.2/X11，当前正式基线DEV110为218/419。本批先完成图片引用定义前131072 UTF-16单元扫描、退到完整换行及整文件不截断的U/I/A。生产和共享原型复用同一边界实现，保留Markdown-it原解析器与源码范围，不以bytes替代units。

同轮预查X06/X08/X10：当前KaTeX随Markdown Worker模块加载，需继续核对/补足独立lazy加载失败恢复；Mermaid当前全局revision变化会重建widget，稳定id/cleanup/ResizeObserver仍需专项实施。本批不擅自放宽这些预期或提前通过，后续继续；原目标仍是全部419。

X11预查缺陷：当前Markdown-it会让窗口外定义参与图片引用解析。只限制图片引用定义的可见集合，不截断整份source，也不无意改变普通链接或直接图片语法。测试同时覆盖中文/emoji、CRLF、131071/131072/131073、跨截点长行和frontmatter前缀。没有模型、系统剪贴板、Codex或日常AIS操作；本地包改动后重建复验，不发布。

## 实现与当前复验

新增共享 `src/shared/markdown-reference-window.mjs`，由生产和原型的 Markdown-it 实例复用。前131072 UTF-16单位按完整LF/CR/CRLF退边界，经原解析器生成图片专用reference集合；普通链接及直接图片仍走完整文档。引用失配时保留完整 `![label][id]` 字面源码，避免意外回退成普通链接。完整文件的parse/index/source始终保留，frontmatter偏移也计入原始单位。

r61真实App在首条场景发现额外生产缺陷：CodeMirror滚出视口销毁DOM后，可以对同一个不可变WidgetType再次调用toDOM。原Block把AbortController绑定在widget对象上，重入使用已经aborted的signal，实际图片无src、naturalWidth=0。修复为每次DOM创建独立controller，所有异步回调/显露事件捕获该次signal；旧DOM回调继续失效。此项也适用于diagram/image共用的Block生命周期，不据此提前认定X08/X10全部通过。

新增U17、原生/真实编译Worker I13及widget生命周期I1，共31条新代码测试；当前相关68条通过，零失败/跳过/Unhandled。I直接演练实际WidgetType的destroy/toDOM生命周期，图像host仅记录原始signal，不冒充图像解码；真实滚动和资源解码留给A。生命周期首轮红测0过1失败（另28条未选），修复后首轮67过1失败是测试把受CodeMirror观察的DOM自行移除并异步等待，触发测试自身重绘；修正为同步演练文档化API，保留失败证据。P模型241、P构建、Sites4、类型检查通过。r62打包及13组真实App复验已通过，正式数219/419（52.27%），余200（198未执行、2阻塞），197条含App。

原引用fixture首轮4过9失败漏了引用定义前的空行，不能算有效产品红测；修正语法后的8过5失败验证无边界限制。随后字面回退缺陷22过1失败已修复；早期23通过及最终边界/native67通过均保留。r61实际App两次首条超时均为上述生产生命周期缺陷；中间一次沙箱127.0.0.1监听EPERM未启动App，也独立记录。r61包保留，不覆盖；新包为r62。

URL观察保留全局created/revoked原始记录，但图片释放断言只覆盖本次实际图片字节长度且无MIME的Markdown blob；启动时晚到的品牌PNG有独立MIME/长度，不属于文档资源，不要求在文档关闭时释放。实际img必须有对应本机path、blob src及naturalWidth>0，不能靠全局URL计数冒充成功。


## 最终构建与边界

r62本机arm64包六项native smoke、81个运行文件哈希、最终类型检查均通过，实际App13组/正常退出code0，观察器/Worker身份恢复，全部Markdown图片blob释放；独立进程核对无本次残留。ASAR 1a093e4f90d4ad7b4d77fec3204f5447e5f6be52b03df00f4b9fe3c2f464f83f；broker及watcher字节与DEV110相同。实际App中8个窗口内reference和1个direct图片均解码为1x1；每份完整源码/尾部/磁盘字节未丢失，无保存RPC。

1072源构建快照SHA 0eaa071dcb0edccac90a7d2dd68744164adcc3421555e4742810e971ad067137；最终1072源实测快照SHA 3f6e3731770aa70b39bad11f10111f30a0099b7d16fa36b6750837634223e6a4，构建后只有外部App驱动调整，生产输入未变。r61旧包与所有中间源码冻结继续保存，两份预算不变。[152项证据](../验收/证据/m9-acceptance-markdown-reference-dev111-r62-20261019.json)，报告SHA adaef1b55c8cc8dca32a0363c10819ab9b01291fd306a66233012bd5415f5707。

额外重复触底实验曾假定EOF选择会再次自动滚动、且视口外widget必须从DOM移除；实际CM保留DOM，另一次wheel实验仍停scrollTop22。两次失败保留为M9-DEV-111-OBS01待定位观察，不宣称额外滚动通过。最终A回到原定13个X11场景，保留实际末尾选择、滚回首部、native解码、源码/尾部/字节及释放断言；同Widget精确生命周期另由I验证。未改变X11预期或其余阶段范围。

历史代码并集2073，不是本批全量执行。完整P/V、物理IME/语音、系统/其它平台及X06/X08/X10等仍待处理；阶段未完成/发布，不触发commit/merge/tag/push。
