# DEV067 PDF 阅读位置恢复

2026-10-18，依据R3.4-P1 / R06.5、R04.6、R04.7；正式验收F14/F15，沿用已确认阅读状态，无新增页面或控件。

## 事实与修复

r19真实App在第3页、150%关闭PDF后，通过“重新打开关闭的文件”恢复成第1页、35%自动适宽。原buffer仅内存保留page/zoom，close栈和数据库route丢失它们，恢复入口重新生成默认route。6项针对性红测失败（原有24项通过），888文件红测源码快照保留。

现有route增加可选严格`pdf: {page, zoom}`提示：页码为正安全整数、zoom为30…800%，多余字段拒绝；旧route无该字段仍可读取。FileBuffer导航变更通知现有workspace持久化，相同值、非法数值和已dispose实例不额外通知。只投影真实PDF的阅读提示；callback附件仍不持久化，TeX生成预览不写入PDF route字段。

恢复入口复用原route模式与阅读提示，仍经当前可信root、有效lease和新document ref进行原生FD核验。已有活跃文件复用，加载完成按实际总页数夹限旧提示并回写。提示不授予文件权限，不保存密码、内容、URL或画布。

## 实证

92项受影响代码、类型检查通过。真实store → FileService/包内broker → SQLite独立连接验证旧能力失效、新能力读取、3/150落盘及新session恢复；真实组件验证999页提示在单页文件夹至1。

r20实际App通过总页数、原生鼠标选中文本、150%真实尺寸、第三页正文/画布、关闭恢复、公开workspaceSnapshot中3/150及工作区重载再次恢复第三页/150%。F15密码缺失/取消/错误/正确、三类损坏、非嵌入CJK/不存在Latin字体混排，以及旋转/只读表单/PDF脚本不执行回归通过。两份缺字体图实际目视可读，text layer为monospace/serif回退，未证明原字体字形/行距完全一致，未宣称签名或表单编辑。

合成正确/错误密码在退出后该测试userData的50份文件及日志原始bytes中均未发现，不覆盖进程内存或其他数据。首轮CJK稀疏暗像素采样误判，改为完整非白像素统计，保留失败；首轮r20重载后面板已恢复，脚本再次点开关误关闭，修正为按实际状态操作，不记产品缺陷。

原型的PDF tab/closed/序列化、initial page/zoom及宿主接线已同步。12项原型模型、构建及4项Sites检查通过；电脑工具返回apps/browsers为空及Native pipe startup failed，P界面未执行，无新像素结论。

## 构建与边界

r20包`/private/tmp/willyou-m9-acceptance-batch-r20-build/mac-arm64/WillYou.app`，ASAR `c9d7a9a62b8c77680a14cbaf816468daf29eeac61e318932d7d985a3071780ce`，六项原生检查通过。889构建源SHA `4e0b85a13f528d32dd57f864392c61001d946422ce2e7c5472e76d5d2319bade`，892最终验收源SHA `591acaf352edef0a1ca1a0c86f528d33989e1ed2fd9c73f637d3c2459512c234`；构建后只有外部验收测试变化，81项编译运行文件与包一致。同包15项音视频及TeX三结果实际回归通过；另有仅移开TeX资源的私有克隆包验证资源不可用时错误与源码返回，原包完整保留。

[本批源码、失败和复验](../验收/证据/m9-acceptance-pdf-tex-dev067-r20-20261018.json)。T32原生保存/T34剪贴板、完整PDF R/P/V、长期资源及注释/交接按各自用例继续，不以F14/F15代替。本机macOS arm64，无提交/发布、AIS或旧任务操作。
