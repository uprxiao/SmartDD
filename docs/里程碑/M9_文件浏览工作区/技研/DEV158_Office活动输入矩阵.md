# DEV158 Office 四类活动输入矩阵（r95已完成）

## 最终结论（2026-10-20）

**最新接续（2026-10-20，DEV158 r95完成）：** 正式 **267/419（63.72%）**，149未执行、3阻塞，149含App；本轮J02与W28两条完整结案。W28相同r95浅深×四宿主×正常/写失败/冲突/只读共32真实App全过，174唯一代码（21新）0skip，六smoke/82运行/类型通过。PPT刷新丢通知缺陷已完整复验，562原V8、46原聚焦按键、552被动watch、源hash/保真/保存→关闭顺序独立通过，64Office线程退出、6自有App全闭，最终3运行正常0/null。1340构建前输入全同+8文件delta可恢复；原r94失败、5U红、驱动/读取器错误全留存于[183项证据](../验收/证据/m9-acceptance-office-active-dev158-r95-20261020.json)，详见[DEV158](DEV158_Office活动输入矩阵.md)。J02见[DEV159](DEV159_PPTX首次基线.md)。未完成项继续，不自动发版；M9仍未完成。

exec60803 PPT14、89976 notes只读2、32542 XLSX16与174代码均已结束，当前无本批活跃App；勿从下方历史handle重启。本轮唯一生产修复在PPT刷新排空/版本保护，未改原生/依赖/P/版本。App32同r95，旧r94仅历史失败/受影响对照。独立审计初稿把XLSX open返回按PPTX sourceHash读取，undefined断言失败；保留原稿与失败记录，按真实XLSX hash/PPTX sourceHash读取，源SHA期待不变，最终562payload通过。

以下为按时间追加的历史运行记录，里面“当前/正在运行/待执行”仅描述当时，不表示仍活跃；最终以本节与正式用例账为准。

## 当前运行更新

r95 notes-readonly两主题均已通过，App `/private/tmp/willyou-office-active-A-gxQlYr` 正常0/null；4原Meta/Ctrl按键、4文档线程退出、32原RPC payload保留。旧exec89976已完成，174代码exec77675也已完成（174全过0skip）。当前exec **60803** 正在运行r95其余PPT14，日志 `/private/tmp/willyou-dev158-r95-pptx-rest-A.log`；先轮询真实handle，不重启已活跃运行。之后同一包 `WILLYOU_ACTIVE_HOSTS=inline,formula` 跑XLSX16，共32唯一组；只有全部证据收齐才升级W28。当前仍265/419。

## 最新修复与接续（2026-10-20）

旧session6023和79577均已终止，不能继续当活跃运行。此前“未见关闭对话框”的描述不准确：exact stack位于驱动42行权限恢复后的可编辑等待，被动click记录已见原关闭prompt及Continue。DEV158-OBS01为生产问题：notes readonly恢复chmod时，原checkpoint在1792432701880至1792432713068忙；changed watch序列13在1792432706591抵达，refresh因busy直接return，后续changed=false未再stat，UI留只读。源保持原版、durable最新保留。

PptxBuffer已改为刷新前后排空队列、合并请求，核对id/localversion/baseHash，旧owner/基线重读、未决冲突保持；仅此生产文件改变。五新竞态U全部红，修复后24PPTU+16真实I=40全部通过、0skip，类型通过。当前r95已完整构建/六smoke；1340源码在构建前全量保存。证据[修复记录](../验收/证据/m9-development-office-active-dev158-r95-fix-20261020.json)，SHA256 `ea2378a17fcff11f838abe9696e22c892e8c6b81ed782c6c4366c651c34c9463`，42归档。下文旧执行描述保留历史，当前以本节为准。

当前真实App exec session **89976**：r95 `WILLYOU_ACTIVE_HOST=notes WILLYOU_ACTIVE_SCENARIO=readonly` 两主题，日志 `/private/tmp/willyou-dev158-r95-notes-readonly-A.log`。174代码 exec session **77675** 已正常结束：174通过、0skip，JSON `/private/tmp/willyou-dev158-code-r95-final.json`。包内82核对已跑至 `/private/tmp/willyou-dev158-runtime-r95.log`。先轮询真实handle，不基于文字推定仍活跃，原观测超时不重启。

两主题notes-readonly通过后，串行跑同一r95：

1. `WILLYOU_ACTIVE_HOSTS=body,notes WILLYOU_ACTIVE_SKIP_KEYS=light:notes:readonly,dark:notes:readonly`，预期14组；与已通过2组形成PPT16。
2. `WILLYOU_ACTIVE_HOSTS=inline,formula`，预期XLSX16；合计本包32唯一组，避免拼旧PPT或缺失只读键分支。r94的15已完整参数保留历史，不替代受影响新验。
3. 当前驱动有四宿主多选/参数skip、真实菜单打开/关闭等待、被动点击、只读后仍存在输入框的原Meta/CtrlS拒绝；PPT正文编辑器若按只读能力移除则记录移除和禁用菜单。已有可编辑目标输入时只等待该控件/焦点，避免附加整页canvas条件；初始打开仍需真实视图就绪。原生结果/队列未修改。
4. 全32、16I/新5U及174回归、原回执/保存关闭顺序/源保真/权限恢复/清理/1340源码恢复审计满足后，才完成W28。届时才266/419；现在仍265/419，151未执行+3阻塞，目标active、未发布。

旧Inspector PID34235/port64428来自已终止自有App，未重新核实不得再连接。r95新App定位信息从新实际进程/输出取得。当前包 `/private/tmp/willyou-m9-acceptance-batch-r95-build/mac-arm64/WillYou.app`，启动CLI二进制在Contents/MacOS/WillYou；静态Node验证仍必须`ELECTRON_RUN_AS_NODE=1`。构建记录 `/private/tmp/willyou-dev158-r95-fast-package-result.json`已passed；不要重复建包。

依据 R3.4/R3.4-P1、R07.16/R07.9、M9-T-W28，2026-10-20。仍在 feature/0.0.1 / `89de9af4b631abdef5673ce8949fb02a32f6fcad` 加工作区。**正式265/419（63.25%），W28尚未通过**，151未执行、3阻塞，未发布。

## 已完成与边界

新增16真实native I通过：XLSX格内/公式对应共用真实模型输入，PPT正文/notes对应各自真实目标，各测正常、源父目录真实IO写拒绝、独立同inode/fsync外改、实际444只读变化。实际Store/FileBuffer/包内Worker/native broker、最新durable draft的pending或OOXML、源hash和明确恢复保存均核验。I公开暂停自动保存来隔离被测动作，实际DOM、焦点、Meta/Ctrl和正常自动保存另由A验证，不能用I的两个相同setter宣称两个DOM宿主均通过。

复用r94，生产、native、构建、依赖、原型及0.0.5版本均未变。既有111代码/六smoke按原证据沿用，本批16新I、82包内运行文件核对及类型检查通过；当前新增五个验证文件与共用方法构成1340输入部分快照。

首A批次完整完成7组：浅色inline的4种状态、formula的normal/write-failure/conflict。第8组formula readonly在菜单尚未确认就绪时立即读Save属性，断言失败；截图中Save已灰，源码有!editable禁用条件，首查询未保存DOM，不能判为产品缺陷或精确断定当时属性。驱动改等待真实可见Save项，从第8组接续25组；该readonly分支已通过，后续仍运行中，不把尚未终止的批次预填通过。

## 当前运行与下一步

- 正在运行的exec session **6023**，本轮自有App PID **34235**，profile `/private/tmp/willyou-office-active-A-iMUmE0/userdata`，日志 `/private/tmp/willyou-dev158-r94-A-resume.log`。这些是本次记录的定位信息，不证明未来仍活着；接续先轮询同一handle/核对真实进程，观察超时不重启。
- 接续25组正常结束后，执行当前驱动的 `WILLYOU_ACTIVE_SCENARIO=readonly` 补验8组。新版在只读后输入框仍存在时发送真实Meta/CtrlS并检查无新原生save；若PPT正文编辑器按能力被移除，记录移除和真实Save菜单禁用。当前运行进程缓存的是menu-ready驱动，文件现版已加只读键补验，不能把未执行的新步骤算作已通过。
- 最终合并首7组与接续25组，核对32唯一参数全覆盖，再关联16I和只读键补验；原失败、三版驱动、源/包hash、输入/输出/截图、权限恢复、原回执与进程清理都保留。整条满足后才更新W28和正式百分比。

## PPT耗时证据

独立只读连接经本轮进程/lsof确认的WillYou Inspector，未改App、原请求或队列。普通PPT open约128ms；checkpoint总10717ms，materialize请求在10648ms后才派发，Worker处理0ms；save总10376ms，派发前10187ms、Worker0ms。不同请求可能重叠，原始所有时间戳保留，不把任一窗口内的首个Worker请求都归属给该API。

源码 `PptxDocument.materialize` 已有按版本失效的snapshot缓存；`FileHeavyJobs`是Office/TeX共用单slot，缓存操作仍可能排在原生转换后。这是排队时序证据，具体完整调度链仍需单独研究，不能冒称新增缓存已经解决性能，也不为缩等待删校验或放开并发。当前功能矩阵继续，后续优化另留红绿及受影响复验。

[部分证据](../验收/证据/m9-development-office-active-dev158-r94-partial-20261020.json)，SHA256 `6967ef6b5c4b53080292fbc84b8fff37a415d4c723d1f10f2433667171bc0d8b`，40项归档。未宣称最终32组、只读键补验、完整V/平台或整个M9完成。
