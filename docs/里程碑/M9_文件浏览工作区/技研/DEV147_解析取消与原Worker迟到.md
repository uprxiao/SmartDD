# DEV147 解析取消与原Worker迟到

依据R3.4/P1、R08.2/R08.7、原K10 I/A；范围/步骤/预期与419分母不变。本轮现有生产实现通过，没有生产修复或原型增量。

| 层级 | 实际范围及结果 |
| --- | --- |
| 新Office I6 | 当前FileService及原包native，真实ASAR NodeWorker。XLSX/PPTX/DOCX各真实请求待完成取消＋真实成功消息生成后延迟交付；关源CANCELLED、线程<=1s退出、服务归0，旧回调不改新目标字节 |
| PDF浏览器契约I12 | 复用原Y18驱动，当前engine/slot源码仅bundle/module适配，真实App鉴权native字节和真实sandbox窗Worker。200页load/page/password/rapid替换各三轮；不是A或新增Y18正式通过数 |
| 正常App A14 | 浅深各三种Office原消息迟到及2000页PDF startup/page请求取消，10故障；再四种格式原文件真实重开4项。旧文件固定标签关闭，新文本/route仍精确保持，9最终Office线程全退出 |
| 代码/类型 | 新I6加原Office会话/页面取消/PDF模型20回归，共26代码、零失败/跳过；最终类型检查通过 |

测试项目只含自有五个文件：三种Office约20MiB原ZIP_STORED未知XML部件加合法OOXML，PDF为2000个真实页面，target.txt为精确29字节控制。大部件参与真实ZIP读取/解析，未把它冒称复杂Office布局/CPU压力；原样本压缩归档保留原SHA与大小，生成器亦可恢复。I另用200页/普通/加密控制样本，不把200页写成2000页。A正常DOCX重开截图已视觉核对真实正文可见。

[Node观察器](../../../../scripts/lib/office-worker-observer.mjs)在本次App或明确I mock构造入口委托原Node Worker、path/resourceLimits/postMessage bytes，仅对原生成功message的原监听回调延期。receipt/delivery的v8序列化SHA相同；关源后原WorkerClient closed guard忽略迟到，实际线程exit已发生。它是明确的原消息交付故障，未制造成功对象，未声称该时CPU仍在解析。观察与原构造器/方法全部恢复。PDF采用原生启动hold或真实debugger pause进行中page/render请求，原timeout仍15s，未改计时器或伪造渲染。原鉴权RPC值及七handler身份恢复，无renderer异常。

首A的10故障检查均过，重开xlsx等待条件直接返回DOM节点，CDP遇到Object reference chain is too long。保存当时driver和原失败，改为Boolean条件后完整14复跑通过；没有因此修改产品或放宽预期。最终A14与PDF I12各正常退出0/null；失败壳仅清理，不计正常退出验收。三个自有App实例已核对退出，隐藏契约窗明确destroy；无日常实例/模型/PTY/剪贴板/外部App操作。

1290最终工程输入由DEV146父1286加4个测试/生成器/driver/观察器恢复；全输入hash与实测基线一致，无后改。清单SHA `ef74b402212c44295695434000e4ee140ea188e63e8ca1ce4ba6d93ec057c2b4`，delta SHA `daf876a69524039ae68905ea0b07a199fa80f31fbeb3366be947e2128cd96ba1`。生产/P/native/deps/config未改，82当前运行资源精确匹配r87，原包/原生hash及六smoke明确沿用，无新打包/全套测试声明。

[65项原始证据](../验收/证据/m9-acceptance-parse-cancel-dev147-r87-20261019.json)，报告SHA `7bd2998c8175eb34c409d6123311c8fe4a8b4b778f450e319f4295b780ca475f`。完整环境、时点、App/原生/源hash及恢复父链见报告。正式257/419（61.34%），160未执行、2阻塞，159含A；不新增P/完整V/平台/长期内存结论，系统/人工/参考限制和DEV139-OBS01/DEV111保留。M9仍开发中，未发布。
