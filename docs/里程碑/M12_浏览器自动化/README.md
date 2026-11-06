# M12 浏览器自动化

更新：2026-11-07。来源：[需求池 F25](../../需求池.md)（并入原 F22-B）。

**状态：S1技术门槛已完成，S2–S5继续收口原验收，S6当前arm64候选已完成安装／原生／启动复验。完整M12仍未交付。** 用户已授权完成S2–S6剩余开发、全部约定验收及缺陷修复；同范围授权持续有效。当前分支为`feature/0.1.1`，没有合并main、打tag或发布。

## 唯一依据与入口

| 产物 | 当前依据 |
| --- | --- |
| 需求 | [需求R1.6及授权记录](需求.md) |
| 技研与开发顺序 | [技术方案V1.6 §11](技研/技术方案.md#11-开发顺序)；[命令映射生成器](技研/命令映射/README.md) |
| 原型 | [原型说明与变更](原型/原型说明与变更.md)；共享工程`prototypes/m6-codex`，入口`?preview=m12` |
| 正式结果 | [原测试用例V1.3](验收/测试用例.md)为唯一正式账；[执行与缺陷记录](验收/执行与缺陷记录.md)记录原红及复验 |
| 执行与资源 | [既有计划continuation](验收/S1执行计划.json)；[当前轮次](验收/并行测试/轮次/M12-20261103T154320Z-bff2/轮次记录.json) |
| 交付 | [交付说明](交付说明.md)，尚未正式交付 |
| 调研与历史 | [调研入口](调研/README.md)；[历史](历史/README.md) |

详细业务规则、具体数字及正式状态只在各自唯一来源维护。开发与验收统一按[项目AGENTS](../../../AGENTS.md)及[真实App自动验收流程](../../真实App自动验收流程.md)执行。

## 当前生产与验收候选

- 当前统一候选为[App026/source030官方构建](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T091/App026-official-build-001/manifest.json)，包含[T091原需求缺陷修复及工程回归](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T091/engineering-fix-001/manifest.json)。[本机arm64安装、原生、受管CLI启动与体积核验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P127/app026-installer-001/manifest.json)已完成；[Root当前候选及未变范围复核](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T091/App026-coordinator-current-001/manifest.json)确认旧结果适用边界，平台及本机DMG路径见交付说明。T091原A／R仍待，未正式分发或发布。
- App025原[实际Host与Native缓存机制实测](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P129/actual-Host-cache-I003/manifest.json)已取得当前修复的直接证据；原I003解析器失败与当时缺项保留；[I004实际停止补证](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P129/actual-Host-cache-I004/manifest.json)已直接验证原Map／Signal及DB转换。不扩大为全部缓存或历史文件清除保证。[真实T125同任务修复复验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P121/t125-coordinator-final-007/manifest.json)已完整收口。
- App025／App024此前安装事实及App023／App022的真实SOP等结果仅按未受影响范围复用。当前变更、源码及二进制身份核对见上述构建与Root复核；旧证据保留原时点结论。
- [原性能验收](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P103/coordinator-case-review.json)、[真实长运行与停止后身份失效](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P109/real35min-coordinator-001/coordinator-case-review.json)按未受影响范围复用，不重复执行或计数。

## 最近闭合与当前缺项

- [T130当前CSV、光栅原输入及Office交接的组件补验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/current-component-root-review-002/manifest.json)已形成实际Native／解析线程与清场证据；[CSV原观察器红及进程角色勘误](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/csv-F17-root-review-001/manifest.json)保留，不外推实际App A／完整T130。[关闭时序独立诊断](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/Root-close-review-004/manifest.json)已区分RPC断连与原进程退出，旧补图技术红未改。

- [T080原完整I静态交接](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T080/App026-full-I-static-ready-001/manifest.json)已复核，等待实际桌面前置，尚未执行。[原型参照支持态完整矩阵](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/P-full-attempt009/manifest.json)与[新增失败态补图](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/missing-source-P-attempt004/manifest.json)已取得；补图原关闭RPC技术红、此前夹具失败及旧图来源均保留，实际App对照仍待，不计正式整条通过。

- [B13已确认缺失来源的合成演示入口修复与原型U](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/prototype-missing-source-U-ready-001/manifest.json)已形成可恢复源码；仅辅助原型增量，新状态实际P仍待，原不可变参照与App026生产包保持各自依据，详见[原型变更](原型/原型说明与变更.md)。

- [T012证书例外原完整A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T012/App025-complete-A001/manifest.json)已完成真实继续／重启保留／撤销再拦及CLI不能代为继续；当前App025复用，无生产重建。

- [T132共存初始内容与两轮未完成原因](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P130/coexistence-A001-A002-partial/manifest.json)和[T125当前包未输入即失焦](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P121/App025-focus-deferred-006/manifest.json)已归档，仍保留原缺项；窗口为驱动失焦后正常收尾，原因未定，不写崩溃或用户主动切走。

- [T004原A＋当前真实模型R完整收口](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P003/coordinator-final-003/manifest.json)，旧合成R未外推，原驱动失败保留。

- [T099原I＋当前活动页A完整收口](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P113/t099-coordinator-final-001/manifest.json)；[T107当前包后台停放与挂回完整收口](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P128/t107-coordinator-final-001/manifest.json)。原driver／环境失败及原I适用边界均保留。
- [下载原U及重开缺陷修复](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P015/download-U-closeout-current-001/manifest.json)和[T130原遗漏两项U](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/nested-breadcrumb-U-gap-001/manifest.json)已完成本批软件子层，父用例仍按权威账保留App缺项。
- [密码stdin/参数脱敏T064](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P124/t064-coordinator-final-001/manifest.json)已完成原I与已有真实R合并验收；未重跑模型。

- [旧版本数据升级T092](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P122/t092-coordinator-final-001/manifest.json)已完成旧项目保持关闭及可见自行添加入口；原观察错误和补图边界完整保留。
- [暂停／恢复T113全部原I+A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P067/t113-coordinator-final-001/manifest.json)已收口。
- [M11原故障回归](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P108/t09-M-root-review-001/manifest.json)已补HTTP／CLI挂住／真实MCP断连；父T131仍保留原T07／T14界面要求。
- [T130当前D04/D06真实App补测](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/app-tabs-actual-005/manifest.json)已通过；[T130原缺组补测](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/final-two-native-UI-001/manifest.json)及[原映射补缺](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/mapped-unit-aspects-001/manifest.json)已有实际证据，完整App矩阵仍待；补充I不替代原App／原型／模型层级。
- [真实T121未复现流程](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P119/t121-coordinator-final-001/manifest.json)已收口；[T120原真实复现](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P120/t120-coordinator-final-001/manifest.json)亦已收口；T125已完成同profile真实修复复验；Cookie恢复界面、授权与活动记录及其余原界面用例按权威账继续。原SOP红、修复来源和发送授权见执行记录；同一已授权payload继续复用现有CLI登录，不重复索取登录。
- [桌面与真实焦点复核](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P116/desktop-wake-and-native-focus-002/manifest.json)已确认当前显示可用，并通过本轮隔离窗口的真实点击取得焦点；[此前合盖预检](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P116/current-desktop-readiness-001/manifest.json)作为历史环境记录保留。该次焦点仅对应原窗口；最近未取得焦点的独立实例见下方接续说明，不能沿用历史焦点。
- [系统剪贴板T088](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P084/current-app022-006/manifest.json)已完成实际I＋S与原全部表示恢复；系统Keychain、双显示器、真实Bug入口和x64真机等未决项见原用例账与计划；未执行、失败、部分结果均不算完整通过。
- [Native私有缓存运行token发现](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P108/native-token-cache-boundary-001/manifest.json)已按用户决定修复并取得当前Host机制实测，受影响回归及原发现边界见执行记录；[处理选项](技研/Native_CLI私有缓存_处理选项.md)已补最小本机开关对照，用户已确认仅受管运行关闭快照，当前安装及Host机制实测已完成，业务续接独立核验。

## 接续顺序

先核当前分支、轮次资源、实际构建和权威账。App025安装、实际Host缓存保护及T125完整收口已有证据，不重跑。用户已明确允许本轮准确PID首次激活一次，仍经真实焦点稳定与原guard；最近一次开窗前只读预检为锁屏，未启动T132新实例，已撤销未执行租约。用户随后明确休息，今晚不再请求解锁，真实焦点／人工及设备前置统一放后。

T091新项目默认浏览器与停用CLI入口修复已完成受影响工程回归；App026/source030官方构建及当前包安装／原生／启动验证已有上述实际证据。技术方案V1.6只校正原需求的实现契约，需求未变；T091仍须真实App与真实Agent验收，不以工程检查代替整条通过。继续准备原完整视觉矩阵及可自主完成的原型检查，真实焦点／系统项目按既有缺项最后处理。

T026已完成[原完整A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P010/t026-coordinator-final-A008/manifest.json)，含最窄拖动与设置；原红及失焦均保留，不重跑。T105亦已完成[原A＋真实R](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P131/t105-coordinator-final-A007/manifest.json)，同一页面登录后原运行Agent快照识别账号；stock CLI仅临时保留当前模型，原模型／沙箱／审批保持。[T123原R＋A完整收口](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P132/T123-App025-complete-R002/manifest.json)及[T124原真实R完整收口](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P132/T124-App025-complete-R009/manifest.json)已按原业务判据复核；前置失效、自动恢复假设、CLI更新菜单与原解析红均保留于执行记录，不重跑已验收项。用户已明确授权后续M12操作与测试发送，不逐项重复询问；仍核实际人工／设备前置。[T017当前A＋I完整验收](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P014/t017-coordinator-final-001/manifest.json)已收口：真实允许／记忆／撤销／Agent不可代答与当前签名包六段组件测试均齐；[旧Native I适用边界核对](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P014/current-native-file-equivalence-review-001/manifest.json)及两轮驱动失败保持原事实。已保存的失败与未决项均不计完成。T015及其他系统、真实Bug和跨机前置按原账保留。

S1与既有批次的原证据、评审和逐批时间线均见执行记录及历史，不从旧阶段摘要推定现状。
