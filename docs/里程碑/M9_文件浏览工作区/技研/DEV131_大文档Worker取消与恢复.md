# DEV131 大文档Worker取消与恢复

依据R3.4/R3.4-P1的R08.11/R06.2与Y06原步骤/预期，当前macOS26.6.1arm64完整U/I/A通过。正式241/419（57.52%），176未执行、2阻塞，175剩余含App。生产/native/原型/样式/依赖未改，复用r75；并非发布。

## 冻结输入、预算与层级

[输入E1](实验/dev131-markdown-worker-inputs.json)冻结100KiB/1MiB/10MiB与R3.4原256KiB/2MiB的并集，复用原`fixtureOfSize`语义生成器：真实中文/emoji/CRLF、frontmatter、链接、列表、表格、代码、数学及Mermaid源，非换成容易通过的纯ASCII。8类损坏JS文本单独固定UTF-8/UTF-16LE字节和码元/hash。

[预算E1](实验/dev131-markdown-worker-budget.json)SHA`b7767bc9b2ce57ca40472db8852746c096a5d4745b464510f86259c66b4f6200`在正式I/A前固定。ready5s/parse15s/主线程longtask100ms/cancel500ms/窗口60块/关闭后postGC30MiB沿用R3.4可行性界限；另在正式前将Worker观测保留堆256MiB、main renderer峰值驻留1GiB列为工程界限。不是普遍SLA或OS内存硬限，不以测后放宽过关。解析计时从原parse投递到真实回包/第一窗口绘制，全文hash/序列化放在测量区间外；未观测到longtask表示无≥50ms报告，不是零工作。

U8逐原块与全窗口核对；I15在真实Node Worker中用self/parentPort桥运行实际ASAR编译字节（SHA`ae5a9d385878c381a40e169cd186c0472e150955a0e21c7ab6453ab0bd7a26b9`），不是重写解析器。Node父线程tick不当浏览器longtask，Node RSS含父/子线程，Worker heapUsed为其isolate。显式包环境23零失败/跳过；默认未配置App的8U通过/15I跳过只是opt-in收集检查，不能算正式执行。

## 实际App五档正式结果

| 精确UTF-8输入 | 原parse到回包 | 首个真实窗口绘制 | 主线程≥50ms任务 | Worker观测保留堆 |
| --- | ---: | ---: | --- | ---: |
| 100KiB | 109.7ms | 191.0ms | 未观测到 | 22072304bytes |
| 256KiB | 77.8ms | 164.3ms | 未观测到 | 37358108bytes |
| 1MiB | 103.7ms | 191.8ms | 未观测到 | 46901604bytes |
| 2MiB | 120.3ms | 195.6ms | 未观测到 | 50163916bytes |
| 10MiB | 349.7ms | 417.5ms | 未观测到 | 143355996bytes |

每档完整原生源文件加载、原索引尾到源码长度、真实≤60块窗口、CodeMirror全文规范化hash和原文件hash核对。不是把全量几万块挂DOM，也没有只用探针假窗代替实际显示。主渲染进程峰值573407232bytes，最终全部文档关闭/GC后main界面堆相对基线增量2746400bytes；主进程、各进程/Worker、活动/关闭后数据均原样留证，不冒称整个App总内存≤1GiB或Worker连续峰值已采到。

## 实际取消、错误和恢复

| 场景 | 实际证据 |
| --- | --- |
| 10MiB解析中取消 | parse投递只上报当前关闭按钮几何，驱动随后真实指针点击；浅深native targetDestroyed距输入11/7ms，未产生原result/window且之后无回包，磁盘源不改 |
| 真15秒看门狗 | 原parse请求原样延迟，不加速时钟；15001.9/15002.3ms触发原timeout状态，目标在terminate约3.8/3.1ms后销毁 |
| Worker异常 | 私有文件在字节相同原模块前加明确startup throw，产生真实可信ErrorEvent，原App显示预览失败并保留源码 |
| 原协议内异常 | 只将本次window start改成-1，原Worker catch返回真实failure，UI明确视口范围错误；不是假消息/假错误 |
| 错误后恢复 | 浅深各三种故障共6次，切回原mode、真实键盘编辑、健康Worker重建/提示清除，原CtrlS/native保存原EOL字节精确 |

Node I另在原模块初始化后的实际Worker内执行exit13或未捕获throw，父进程区分exit与error并创建健康新Worker；这不是声称浏览器提供process.exit或硬崩溃整个renderer的控制。App原生ErrorEvent/协议failure/timeout可读区分且主进程、界面和后续保存均存活。

## 损坏输入与编码边界

NUL、孤立代理对、5000层引用标记/500层列表、2M长行、未闭合围栏、2000列表格、深强调全部由真实U/I解析且原raw范围/字节不变；U遍历全部窗口，I保留完整索引并请求原60块协议窗口。孤立代理对按UTF-16LE码元字节往返，不能伪称有效UTF-8。

App从实际文件入口读取其中6类有效文本，真实Worker/窗口及CodeMirror全文hash不丢失，磁盘不改，解析期无≥50ms任务。NUL和UTF16孤立代理对物理文件按既有codec分别明确二进制/不支持UTF16并保留原字节；不绕过安全编码策略、不冒称这两项在App Worker里解析成功。8类JS字符串的解析义务已在U/I真实编译引擎覆盖。整个批次为正常A5+故障/损坏A16，共21检查、2次选定正常退出。

## 观察失败和复用经验

第一探索观察器强持有Worker，其原onmessage闭包能持有编辑器与全文，5档关闭后main堆增59703860bytes；改WeakRef后探索2734096、正式2746400。保留原始两轮探索，不把前值判为产品泄漏，也没有放宽预算。首强引用观察器没有独立留历史源码快照，未补造当时SHA；最终弱引用实现可恢复。元数据观察不复制整文，不把移除监听当“无迟到消息”，实际目标销毁另由native CDP核对。

首U相对导入路径错误、首次TypeScript对unknown解析对象的结构检查缺失属于测试驱动失败；保留日志，补运行时结构核对后23/类型/默认收集通过。已有DEV111额外巨型文档底部滚动观察仍未分类，这一条不冒称已解决它或全部滚动语义。

[Electron官方MemoryInfo](https://www.electronjs.org/docs/latest/api/structures/memory-info)说明单位为KB，[42.0 API基础实现](https://github.com/electron/electron/blob/v42.0.0/shell/browser/api/electron_api_app.cc#L1351-L1365)对字节右移10位；本机同PID原始memoryUsage.rss与workingSetSize比值1024进一步支持乘1024。实际包为Electron42.11.14/Chrome148.0.7778.280/Node24.19.0；精确patch源码抓取失败，不把基础源码冒称对应patch已核对。

驱动：[冻结样本](../../../../scripts/files/markdown-worker-fixtures.mjs)、[元数据/弱引用观测](../../../../scripts/lib/markdown-parse-observer.mjs)、[原生target观测](../../../../scripts/lib/worker-target-observer.mjs)、[正常性能](../../../../scripts/files/markdown-worker-ui.mjs)、[故障恢复](../../../../scripts/files/markdown-worker-faults-ui.mjs)。方法已加入[共用流程](../../../真实App自动验收流程.md#大文档解析的低开销观测与真实终止dev131)。源码U/I位于生产Markdown目录的`worker-source-acceptance.test.ts`与`worker-native-acceptance.test.ts`，未复制一套产品实现。

## 构建与交付边界

当前r75 ASAR`59c70a032437fcac22ab8e7775ea6956079b549079523b4f896f43a65e291e26`；生产输入/原型/样式/依赖不变，既有六native smoke与82运行文件沿用同包有效证据。1206源/资料快照tar SHA`ddfb0914dff870062a80c46de6293718ed028b6854aac6bfbc232f1d923e2c6f`，自有项目夹具另压缩SHA`9c45ab37ea21356edf83c949bdeccec8f0424ae575b59428daf7ef11e87de6b7`；不归档userData/数据库/整个App。[50项证据](../验收/证据/m9-acceptance-markdown-worker-dev131-r75-20261019.json)SHA`1d747d9fc01166be7a5bae583d144141ca8408b8c09cb24d956008e90a7ded14`，前12项完成补证不改。所有本次App和观测到的Worker目标均结束，原函数恢复。

P页面/入口/源码/样式无新改动，查看了深色timeout保留源码实际截图，未声明新完整Codex像素或系统IME/其他平台结果。接续Y07任务项/原链接及Y08图表生命周期；M05的X、H20条件、X03参考、嵌入图像与其他系统/人工/平台缺项继续。阶段未完成，未提交、合并、tag、推送或发布。
