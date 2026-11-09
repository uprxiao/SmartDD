# M12 浏览器自动化

更新：2026-11-09。来源：[需求池 F25](../../需求池.md)（并入原 F22-B）。

**状态：当前本机 macOS arm64 已具备条件的原约定开发与验收完成；T145 已按原合同收口。Intel 真机 T141 按用户决定暂缓、未计通过，完整 M12 平台验收尚未完成。当前候选 App058/source069，分支 `feature/0.1.1`，未合并 main、打 tag 或发布。** 结果以[唯一正式用例账](验收/测试用例.md)、[最终 T145 核验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/original-T145-final-456-closeout-001/root-adjudication.json)及[交付说明](交付说明.md)为准。

用户已于2026-11-08明确恢复测试；原暂停交接保留，T083已按原四系统分支与恢复清场收口，继续其余原系统／真实服务／设备缺项，见[当前轮次](验收/并行测试/轮次/M12-20261103T154320Z-bff2/轮次记录.json)与[执行记录](验收/执行与缺陷记录.md)。

[T083原完整S及原失败保留](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T083/original-S-complete-native-ACL-restored-001/manifest.json)、[独立归档判定](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T083/original-S-independent-archived-judge-001/manifest.json)已形成；Chrome访问控制已恢复原样，本轮自有资源已清场。

T127已完成原用例允许的“真实读取后缺信息→按T122询问”分支，见[Root原合同判定](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T127/real-R001-root-final/manifest.json)。没有执行真实业务网页复现，用户已暂缓这项额外操作；当前继续原视觉验收。

T110 已按原合同完成双屏、全屏、桌面切换及后台操作验收，见[实际完整系统证据](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T110/App045-S005-original-S-complete/manifest.json)与[协调者独立归账](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T110/coordinator-original-S005-final/manifest.json)。剩余 T145 视觉及用户暂缓的 T141 真机项继续按唯一正式账登记。

## 唯一依据与入口

| 产物 | 当前依据 |
| --- | --- |
| 需求 | [需求R1.9及授权记录](需求.md) |
| 技研与开发顺序 | [技术方案V2.0 §11](技研/技术方案.md#11-开发顺序)；[命令映射生成器](技研/命令映射/README.md) |
| 原型 | [原型说明与变更](原型/原型说明与变更.md)；共享工程`prototypes/m6-codex`，入口`?preview=m12` |
| 正式结果 | [原测试用例V1.6](验收/测试用例.md)为唯一正式账；[执行与缺陷记录](验收/执行与缺陷记录.md)记录原红及复验 |
| 执行与资源 | [既有计划continuation](验收/S1执行计划.json)；[当前轮次](验收/并行测试/轮次/M12-20261103T154320Z-bff2/轮次记录.json) |
| 交付 | [交付说明](交付说明.md)，尚未正式交付 |
| 调研与历史 | [调研入口](调研/README.md)；[历史](历史/README.md) |

详细业务规则、具体数字及正式状态只在各自唯一来源维护。开发与验收统一按[项目AGENTS](../../../AGENTS.md)及[真实App自动验收流程](../../真实App自动验收流程.md)执行。

## 当前生产与验收候选

- 当前候选 App058/source069：[深色浏览器菜单局部修复构建](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/dark-menu-engineering-App058-001/root-adjudication.json)及[实际两组合复验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App058-dark-menu2-internal003-original-complete-root-reviewed/root-adjudication.json)通过；本包[原安装九阶段及真实 CLI 回归](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P127/app058-installed-startup06-09-001/root-adjudication.json)已完成，原外屏缺项已补齐；正式结论见[最终 T145 核验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/original-T145-final-456-closeout-001/root-adjudication.json)。

- 既有候选 App057/source068：[菜单样式修复正式构建及原生检查](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/menu-style-engineering-App057-001/root-adjudication.json)已完成；本包[原arm64安装九阶段及实际受管CLI回归](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P127/app057-installed-startup06-09-001/root-adjudication.json)已完成；剩余视觉实际复验继续，详见唯一执行计划和执行记录。

- 既有候选 App056/source067：[证书警告样式修复正式构建与原生检查](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/certificate-style-engineering-App056-001/manifest.json)完成；当前包[本机arm64安装、启动及受管CLI回归](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P127/app056-installed-startup06-09-001/root-adjudication.json)已完成；T145原错误页及其余受影响状态继续复验，详见[当前执行记录](验收/执行与缺陷记录.md)。此前包的结论保留各自身份与适用边界。

- 既有候选 App055/source064：[标签栏图标修复与原型菜单同步构建](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/tabstrip-menu-engineering-App055-001/manifest.json)已完成，相关[焦点、模型及类型检查](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/tabstrip-menu-software064-001/manifest.json)通过；实际受影响界面复验仍待；当前包[本机arm64完整安装与受管CLI回归](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P127/app055-installed-startup06-09-001/root-adjudication.json)已完成。App054旧结果保留其包身份。

- 既有候选 App054/source063：[来源／成功态集中修复正式构建](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/import-source-success-engineering-App054-001/manifest.json)已通过，当前原型已核，实际受影响App复验仍待；本机arm64[安装原九阶段及实际受管CLI回归](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P127/app054-installed-startup06-09-001/root-adjudication.json)已完成；实际受影响UI、完整S6及T145仍待。

- 后续来源／成功态的[同范围布局修复及软件检查](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/import-source-success-software063-001/manifest.json)已完成软件检查并进入当前App054目录包，当前原型参考已实际验证，真实App复验仍待。

- 上一候选 App053/source062：[恢复／确认差异集中修复与正式构建](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/profile-visual-engineering-App053-001/manifest.json)已通过，实际受影响界面与最终安装验收仍待。原登录态与设置确认的状态视觉判据收口见执行记录，不扩大为完整T145通过。

- 上一候选 App052/source061：[输入错误页样式与导入图标修复／正式构建](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/invalid-style-engineering-App052-001/manifest.json)已完成，当前实际界面复验与最终安装验收待完成。

- 上一候选 App051/source060：[输入校验原型对齐与设置间距修复／正式构建](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/address-validation-engineering-App051-001/manifest.json)已完成软件及原生检查，继承恢复窄区换行修复；实际界面／视觉及最终安装验收尚待。

- 上一候选 App050/source059 的[正式构建与原生检查](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/recovery-wrap-engineering-App050-001/manifest.json)已通过。针对App049实测窄区溢出的CSS修复，尚待实际界面复验；最终安装验收仍待。

- 上一候选 App049/source058 已完成[正式构建与原生检查](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/cookie-recovery-engineering-App049-001/manifest.json)。B13 恢复提示及导入确认样式修复的软件检查已通过，[source058 草修与证据](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/cookie-recovery-visual-source058-software-001/archive-manifest.json)。App049 真实界面／视觉及最终安装验收尚待；App048 历史结果只按未受影响的冻结范围复用。

- 当前目录包候选App048/source057，[导航回退与共用工具栏修复／正式构建](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/address-toolbar-engineering-App048-001/manifest.json)完成。T010已通过当前App048真实回退／重试及301／标题／图标补验并合并归账；T145按原同名状态分批采集与逐图对照，尚未整条通过。前台批次已清场释放，现后台准备剩余系统／证书前置及原图复核。

- 上一目录包候选App047/source056，[本批集中修复及正式构建](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/profile-failure-visual-engineering-App047-001/manifest.json)完成，正复验修复并连续补原视觉矩阵。[导航缺项实际采集](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App047-navigation-A043-captured13/manifest.json)、[交互缺项实际采集](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App047-interactions-A044-captured28/manifest.json)、[权限提示缺项实际采集](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App047-permission-A045-captured4/manifest.json)已保存，均待逐图判定；当前候选最终安装回归仍待。

- 上一目录包候选App046/source055，[下载工程与正式构建](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/download-visual-engineering-App046-001/manifest.json)及[下载实际定点复验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App046-download-A031-scoped-reviewed24/manifest.json)已完成。当前连续执行剩余视觉矩阵：[登录态管理实际采集](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App046-profiles-A039-captured24/manifest.json)、[恢复警告实际采集](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App046-recovery-prep002-captured16/manifest.json)、[授权弹框实际部分结果与原超时](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App046-access-A040-valid21-binding-timeout/manifest.json)均已保存；视觉差异仍需集中修复复验，不能由采集成功推定整条通过。当前候选最终安装回归仍待。

- 此前目录包候选为App045/source054，[截止时间接线与正式构建](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/activity-deadline-engineering-App045-001/manifest.json)已完成；[首组实际倒数、切标签与到期验证](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App045-countdown-A029-valid3-focus-yield/manifest.json)有效，随后失焦已正常收尾，剩余组合接续。下载原图发现的同类样式差异及未受测矩阵仍待，详见执行记录；未完成最终安装回归或完整视觉验收。

- 此前候选为App042/source050，[官方构建与范围内软件检查](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/external-prompt-engineering-App042-001/manifest.json)完成；外部应用提示实际复验已完成，活动暂停样式缺陷及最终安装回归仍待。下列App041及更早结果保留各自构建身份，按未受影响范围复用。

- 此前视觉候选为App041/source049，[官方构建及软件检查](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/auth-find-engineering-App041-001/manifest.json)与[认证／查找定点复验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App041-auth-find-A012-reviewed12/manifest.json)完成，完整视觉及最终安装回归仍待。此前App039/source046，修复登录态详情窄按钮越界，[当前原型回归](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/source046-B12-P8-complete/manifest.json)、[实际App039回归](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App039-B12-A008-complete/manifest.json)及[Root逐图核对](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/source046-root-affected-review/manifest.json)已完成；完整视觉矩阵及App039安装回归尚未完成。下面App038及更早构建保留原时点身份和适用边界。


- 上一生产候选为App038/source045，停放窗菜单修复已按[T109当前S组合复验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T109/App038-menu-S002-complete/manifest.json)收口；[App037完整安装回归](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P127/app037-installer-001/manifest.json)已完成。[App038 arm64完整安装回归](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P127/app038-installer-001-complete-07-09/manifest.json)已完成，包含实际启动、受管CLI与最终判定；[原T130 U＋A回归](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/T130-final-original-UA-composition/manifest.json)已收口；后续遵照用户安排补原系统／真实服务／设备缺项。

- 此前候选为[App037/source044软件及官方构建](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P075/T146-tooltip-software-App037-build-001/manifest.json)，[完整标题实际A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P075/T146-App037-current-A001-003/manifest.json)及该包安装S6均已完成，App038安装回归见上链，不宣称完整M12交付。

- 上一轮已安装候选为[App036/source040官方构建](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/App036-official-build-001/manifest.json)，源码提交`d238562b`，修复预览标题复用时遗漏显式查看器选择。[相关工程红绿与类型检查](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/title-viewer-priority-unit-fix-001/manifest.json)和[当前包安装／原生／受管CLI启动](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P127/app036-installer-001/manifest.json)已完成。[受影响本地查看器菜单回归](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/viewer-menu-App036-A003-five-complete/manifest.json)已收口，原失焦历史保留；实际外开、完整视觉／系统及设备验收仍待；原App035等证据仅按未受影响范围保留，不据新包存在宣称完整交付。

- 此前已安装验收源码提交`a3a0c90d`对应App031/source035，[官方构建及组件复验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P105/Cookie-error-App031-build-001/manifest.json)和[受影响实际界面复验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P105/Cookie-error-App031-A001-complete/manifest.json)完成；[当前arm64安装／原生／启动复验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P127/app031-installer-001/manifest.json)已完成，其余原缺项继续。

- 此前本机arm64已安装复验候选为[App030/source034](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P127/app030-installer-001/manifest.json)，源码提交`0c10174a`。完整下载及授权已按各自原合同收口；其它原用例与x64仍待，不代表完整M12交付或发布。

- 此前完成安装回归的候选为[App027/source031官方构建](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App027-official-build-001/manifest.json)，继承已完成的T091生产修复，并接入标题栏测宽布局修复。[当前arm64安装、原生、受管CLI启动与体积核验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P127/app027-installer-001/manifest.json)已完成；[受影响原型交互复验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/header-observer-P-003/manifest.json)通过，实际App标题栏视觉矩阵仍待。[T091原A／R](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T091/coordinator-final-002/manifest.json)已完整通过；未正式分发或发布。
- App025原[实际Host与Native缓存机制实测](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P129/actual-Host-cache-I003/manifest.json)已取得当前修复的直接证据；原I003解析器失败与当时缺项保留；[I004实际停止补证](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P129/actual-Host-cache-I004/manifest.json)已直接验证原Map／Signal及DB转换。不扩大为全部缓存或历史文件清除保证。[真实T125同任务修复复验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P121/t125-coordinator-final-007/manifest.json)已完整收口。
- App025／App024此前安装事实及App023／App022的真实SOP等结果仅按未受影响范围复用。当前变更、源码及二进制身份核对见上述构建与Root复核；旧证据保留原时点结论。
- [原性能验收](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P103/coordinator-case-review.json)、[真实长运行与停止后身份失效](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P109/real35min-coordinator-001/coordinator-case-review.json)按未受影响范围复用，不重复执行或计数。

## 最近闭合与当前缺项

- [P03原完整A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/P03-App036-A001-complete/manifest.json)、[P05原完整A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/P05-App036-A002-complete/manifest.json)已在当前App036完成；原计划内窗口状态步骤与意外失焦严格区分，原错误前置及派生判断纠正保留。文件区其余原缺项继续，完整M12尚未交付。

- [当前本地查看器菜单](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/viewer-menu-App036-A003-five-complete/manifest.json)已补齐，原失败与当前正面观察分别保留；[外开接收器资格](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/F01-native-qualification-015-failed/manifest.json)仍未通过，闲置临时App已清理。实际系统外开未计通过，完整M12尚未交付。

- [D21原完整A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/D21-App036-A001-complete/manifest.json)已在当前App036收口，原红保留；[P03原失败前置污染诊断](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/P03-precondition-diagnosis-001/manifest.json)明确尚未到最小化，系统恢复条件仍待。文件区其余缺项按既有计划继续，完整M12尚未交付。

- [D11原完整A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/D11-App036-A001-complete/manifest.json)、[D19原完整A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/D19-App036-A001-complete/manifest.json)已在当前App036定点收口；原失败与保护边界保留，未重复构建或已绿组。文件回归其余缺项仍见既有计划，完整M12尚未交付。

- [外开接收器技术预检与清场](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/F01-native-receiver-preflight-001/manifest.json)已归档；系统候选注册前置未就绪，未执行产品外开流程，未增加完整通过用例。已停止反复夹具试验并删除该自有临时App；系统实按与红框后置项见既有计划。

- [当前菜单的自有HTML子视图焦点诊断](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/viewer-menu-App036-A002-owned-view-diagnostic/manifest.json)已取得真实归属快照，但当时后续拒绝条件未完整留证；该旧负条件原因仍未知。当前本地菜单结果见上方新证据，不据旧诊断增加原用例通过数。

- [来源前置组合复核](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/navigation-applicable-closeout-001/manifest.json)已按原用户确认修正条件适用性；[接口查看器优先级修复](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/title-viewer-priority-unit-fix-001/manifest.json)已通过相应U/I和类型检查，source040／App036官方构建与本机安装验收已完成；受影响菜单的实际App回归部分执行后失焦停止。当前候选见上方，完整M12尚未交付。

- [元数据／权限失败与恢复原A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/F02-App035-A002-complete/manifest.json)已补齐当前合法名称搜索入口与真实重试，原禁用树入口和静态准备错误保留；下一任务／终端与导航原缺项继续。

- [基础标签原A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/basic-tabs-App035-A001-complete/manifest.json)已完成预览替换／固定、邻接关闭和两种正常重启回归；任务／终端共存与其它原缺项继续。

- [静态预览原A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/F07-F09-App035-A002-complete/manifest.json)已在当前候选收口，原虚拟行门闩及准备夹具换行错误均保留；基础标签和元数据原回归继续。

- [草稿别名恢复原A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/D22-App035-A002-complete/manifest.json)已完成真实重启／恢复与保存回归，原驱动返回值红及前置边界保留；静态预览和基础标签原剩余组继续。

- [Notebook原完整A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/F21-App035-A003-complete/manifest.json)已在当前候选收口，原沙箱等待红与有效旧观察均保留；阅读位置恢复因失焦留待配合，后续原独立组继续。

- [标签与布局正常重启、故障恢复及延迟送达原A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/tab-restore-App035-A003-complete/manifest.json)已在当前候选收口；原驱动／启动失败保留，文件区其余原回归继续。今晚后置与用户配合边界见[现有执行计划](验收/S1执行计划.json)。

- [TeX原完整A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/F16-App035-A002-complete/manifest.json)与[工作簿原完整A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/F18-App035-A003-complete/manifest.json)已在当前包完成；原红、夹具来源、只读宏与源保护均归档。T130继续按[原U/A合同勘误](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/original-U-A-layer-scope-correction-001/manifest.json)核其余原业务，原来源层级标签单列，不据子组计父通过。

- [DOCX原六业务场景](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/F19-original-six-coordinator-001/manifest.json)已复核完成；[原PPTX预览A子组](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/F20-App031-A001-complete/manifest.json)完成；[窄终端实际界面红测](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P144/host-App031-A002-narrow-layout-red/manifest.json)与[原型一致性差异](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P144/launcher-settings-design-review-001/manifest.json)已形成，按新候选复验；DOCX的原红及旁路观察缺项保留，其他原矩阵不删减。

- [本地HTML原实际App两流程](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/F24-App031-A001-complete/manifest.json)已完成，源码保护、真实Native文档交互及隔离安全边界均有证据。剩余Office预览与可自动Host视觉矩阵继续准备；[长标题原生截图能力缺项](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P075/T146-App031-002-native-identity-gap/manifest.json)如实后置，不替代为通过。

- [归档与二进制原实际App子组](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/F26-F27-App031-A001-complete/manifest.json)已完成，原文件保护、错误载体及无编辑入口均核对；HTML已按下条证据收口，继续其余原矩阵。

- [M11网关兼容原全部子用例](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P108/coordinator-final-001/manifest.json)已完整通过；停止、停用、断开及正常重启均有实际界面／CLI／Host证据，旧驱动失败保留。继续原文件预览及视觉／系统／平台缺项。
- [PDF及音视频实际App完整子组](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/PDF-media-App031-A-complete-001/manifest.json)已完成，[F15安全与特殊PDF](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/F14-F15-App031-A001-partial/manifest.json)按原有效证据复用；父用例仍需其余原矩阵。

- [Cookie导入失败恢复原完整I＋A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P105/coordinator-final-001/manifest.json)已收口，包含恢复失败、两处禁用、真实界面重试与确认清空；旧失败及合成故障边界均保留。[独立错误文案缺陷的App031实际回归](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P105/Cookie-error-App031-A001-complete/manifest.json)及[当前arm64安装复验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P127/app031-installer-001/manifest.json)已完成；该段App031为历史验收基线；当前候选见上方。

- [T130原F12/F17实际App子组](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/F12-F17-App030-A003-complete/manifest.json)已完成；[原失败与协调复核](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/F12-F17-coordinator-004/manifest.json)保留。[F11/F13/F25实际App子组](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/F11-F13-F25-coordinator-003/manifest.json)亦已完成；父用例的其余原矩阵仍待。

- [T095原完整A／真实R](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T095/coordinator-final-009/manifest.json)已完成。全部原业务及历史授权来源实际可见，旧失败与独立清场保留；App030本机安装复验已完成，继续原文件预览及其它原缺项。

- [下载中断实际定位](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P015/App029-interrupt-background-red-001/manifest.json)已确认可恢复中断未收尾；[修复回归及App030官方构建](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P015/App030-interrupt-fix-build-001/manifest.json)通过，[后台真实中断复验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P015/App030-interrupt-background-green-002/manifest.json)亦通过；[完整下载U／A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P015/coordinator-final-005/manifest.json)已收口，[App030本机arm64安装／原生／启动复验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P127/app030-installer-001/manifest.json)已完成；x64与其余原用例保持待验边界。

- [App029/source033官方构建](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P015/App029-official-build-001/manifest.json)及[原严格下载几何复验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P015/App029-geometry-green-002/manifest.json)通过；下载Esc已在App028真实复验。[原完整下载A002部分结果](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P015/App029-A002-partial/manifest.json)的中断缺口已由App030实际复验及完整A收口；原红保留。全部测试与发送沿用用户统一授权，不再逐项询问。

- [Esc修复后的App028官方目录包](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P015/App028-official-build-001/manifest.json)保留中间工程检查与真实Esc复验事实；完整下载已在App030收口，App027仍保留其已验证安装结果和T095固定验收依据。

- [T091默认选用／取消后真实拒绝](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T091/coordinator-final-002/manifest.json)和[T132网页／HTML／MCP共存回切](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P130/coordinator-final-003/manifest.json)已完整收口，原解析／夹具红及边界保留；[T080导入](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T080/coordinator-final-003/manifest.json)同批已归账。

- [T130当前CSV、光栅原输入及Office交接的组件补验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/current-component-root-review-002/manifest.json)已形成实际Native／解析线程与清场证据；[CSV原观察器红及进程角色勘误](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/csv-F17-root-review-001/manifest.json)保留，不外推实际App A／完整T130。[关闭时序独立诊断](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/Root-close-review-004/manifest.json)已区分RPC断连与原进程退出，旧补图技术红未改。

- [原文件预览App验收静态交接](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/F12-F17-App026-A-static-ready-001/manifest.json)保留其当时准备事实，现已在上述App030实际完成F12/F17子组；[标题栏遮挡调查](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/header-overlap-static-001/manifest.json)确认原型问题，现已形成测宽布局修复及受影响P绿测；当前App A仍须原判据实测。
- [T080原完整I静态交接](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T080/App026-full-I-static-ready-001/manifest.json)已复核；[App027完整I及Root复核](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T080/coordinator-final-003/manifest.json)已完成，原驱动红与判定字段错误均保留，不重跑业务。[原型参照支持态完整矩阵](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/P-full-attempt009/manifest.json)与[新增失败态补图](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/missing-source-P-attempt004/manifest.json)已取得；补图原关闭RPC技术红、此前夹具失败及旧图来源均保留，实际App对照仍待，不计正式整条通过。

- [B13已确认缺失来源的合成演示入口修复与原型U](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/prototype-missing-source-U-ready-001/manifest.json)已形成可恢复源码；[新状态实际P补图](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/missing-source-P-attempt004/manifest.json)已取得，原关闭技术红保留，[“完成”后的返回／重开交互](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/header-return-P-001/manifest.json)已补验。原不可变参照与App026生产包保持各自依据，详见[原型变更](原型/原型说明与变更.md)。

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
- [真实T121未复现流程](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P119/t121-coordinator-final-001/manifest.json)已收口；[T120原真实复现](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P120/t120-coordinator-final-001/manifest.json)亦已收口；T125已完成同profile真实修复复验；其余原界面用例按权威账继续。原SOP红、修复来源和发送授权见执行记录；同一已授权payload继续复用现有CLI登录，不重复索取登录。
- [桌面与真实焦点复核](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P116/desktop-wake-and-native-focus-002/manifest.json)已确认当前显示可用，并通过本轮隔离窗口的真实点击取得焦点；[此前合盖预检](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P116/current-desktop-readiness-001/manifest.json)作为历史环境记录保留。该次焦点仅对应原窗口；最近未取得焦点的独立实例见下方接续说明，不能沿用历史焦点。
- [系统剪贴板T088](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P084/current-app022-006/manifest.json)已完成实际I＋S与原全部表示恢复；系统Keychain、双显示器、真实Bug入口和x64真机等未决项见原用例账与计划；未执行、失败、部分结果均不算完整通过。
- [Native私有缓存运行token发现](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P108/native-token-cache-boundary-001/manifest.json)已按用户决定修复并取得当前Host机制实测，受影响回归及原发现边界见执行记录；[处理选项](技研/Native_CLI私有缓存_处理选项.md)已补最小本机开关对照，用户已确认仅受管运行关闭快照，当前安装及Host机制实测已完成，业务续接独立核验。

- [下载Esc真实缺陷定位](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P015/App027-Esc-diagnostic-002/manifest.json)已确认菜单卸载后的BODY焦点路径；生产与合成原型修复及相关组件回归完成，新包与原完整下载验收待。原App027部分结果和失败完整保留。

- [终端共存原三组](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/terminal-coexistence-App035-A001-complete/manifest.json)、[任务标签原两项](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/task-tabs-App035-A002-two-complete-D18-baseline-red/manifest.json)及[面板尺寸恢复原A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/A11-App035-A001-complete/manifest.json)已完成；[普通PDF定位](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/F29-PDF-App035-A001-partial-complete/manifest.json)仅原子段。其它原矩阵、系统和设备缺项继续按[现有计划](验收/S1执行计划.json)，完整阶段尚未验收。

- [原文件身份与别名验证](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/D05-App035-A002-complete-independent-review/manifest.json)及[拖动性能／停止恢复原组](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/terminal-layout-App035-A002-P04-P07-complete-P03-red/manifest.json)已收口；独立复核、原判定红和未完成窗口恢复均分列保留。

- [文件独立读取原完整矩阵](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/S09-App035-A002-complete/manifest.json)已完成，原终端状态／外写／迟到返回边界及首轮适配红均保留；其余入口和系统缺项按现有计划继续。

- [标签拖动原完整A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/Y40-App035-A001-complete/manifest.json)与[根失效恢复原完整A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/D24-App035-A001-complete/manifest.json)已完成；原故障注入／浏览器拖动边界及未记录数据均如实分列。[现有计划](验收/S1执行计划.json)已按技术缺口、系统动作、用户／设备前置标识剩余项；本轮实例已清场，完整阶段仍待验收。

## 接续顺序

先核当前分支、轮次资源、实际构建和权威账。App035已完成本机arm64安装与启动复验；有效旧证据按未受影响范围复用。统一测试与发送授权持续；每次沿已有准确PID首次激活、真实焦点稳定及原guard继续，不再逐项询问。T081等已按原合同归账；T130已补齐图片、CSV、SVG、TIFF及不支持格式提示／菜单入口的实际A子组，T131原运行生命周期已收口，继续其余原矩阵及系统／设备缺项。App031错误文案实际回归与安装复验均已完成，不重跑未受影响的已绿业务。

标题栏修复已通过受影响八组合原型交互，原容器候选菜单遮挡红保留。当前源和包身份见上方官方构建，旧原型参照只复用未变范围，受影响标题状态使用新基线；实际App矩阵、系统及外部条件缺项不因工程检查通过而收口。

T026已完成[原完整A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P010/t026-coordinator-final-A008/manifest.json)，含最窄拖动与设置；原红及失焦均保留，不重跑。T105亦已完成[原A＋真实R](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P131/t105-coordinator-final-A007/manifest.json)，同一页面登录后原运行Agent快照识别账号；stock CLI仅临时保留当前模型，原模型／沙箱／审批保持。[T123原R＋A完整收口](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P132/T123-App025-complete-R002/manifest.json)及[T124原真实R完整收口](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P132/T124-App025-complete-R009/manifest.json)已按原业务判据复核；前置失效、自动恢复假设、CLI更新菜单与原解析红均保留于执行记录，不重跑已验收项。用户已明确授权后续M12操作与测试发送，不逐项重复询问；仍核实际人工／设备前置。[T017当前A＋I完整验收](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P014/t017-coordinator-final-001/manifest.json)已收口：真实允许／记忆／撤销／Agent不可代答与当前签名包六段组件测试均齐；[旧Native I适用边界核对](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P014/current-native-file-equivalence-review-001/manifest.json)及两轮驱动失败保持原事实。已保存的失败与未决项均不计完成。T015及其他系统、真实Bug和跨机前置按原账保留。

S1与既有批次的原证据、评审和逐批时间线均见执行记录及历史，不从旧阶段摘要推定现状。


当前补齐的PPTX实际A及视觉首轮发现见[执行与缺陷记录](验收/执行与缺陷记录.md)。窄区启动按钮已在App032实际复验；弹框与登录态样式已接续App035，当前界面失焦缺项继续后置。各历史包的原红与有效证据保留，完整M12尚未交付／发布。

用户要求的[闲置测试包清理](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P144/unused-packaged-apps-002/manifest.json)已完成；只移除确认闲置的生成App与重复安装文件，保留当前包、源码、证据、依赖和登录数据。


2026-11-08继续：[D23原UI恢复与保存分支](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/D23-App036-A002-UI-branch-complete/manifest.json)已完成，[复制保护拒绝](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/D23-App036-A001-copy-unclaimed/manifest.json)与[Named预检红绿](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/D23-clipboard-named-qualification-001/manifest.json)分列保留；复制与实际外开仍待，原完整阶段尚未验收。红框项目按用户指令后置，当前可自动分支与系统缺项见[执行计划](验收/S1执行计划.json)。


2026-11-08继续：[T024标题栏／项目入口实际A子集](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T024/App036-A001-titlebar-subset/manifest.json)已补齐；系统快捷键、无项目任务及PPTX编辑冲突仍待，未计整条通过。原完整阶段和发布结论不变。


当前自主可执行分支已归档，验收在[原计划的前置等待记录](验收/S1执行计划.json)处接续；系统操作、外部对象及设备条件仍待，完整M12尚未验收完成。用户既有测试授权持续，不重复请求授权。


用户已恢复目标并确认可配合系统补验；T0按[测试V1.4](验收/测试用例.md)使用历史夹具，原负向要求保持。首轮实按尚未收到按键已正常收尾，当前在[现有执行计划](验收/S1执行计划.json)记录的窗口观察答复处接续。


2026-11-08用户配合补验：[真实系统按键](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-SystemKeys/App036-001-002/manifest.json)与[PPTX冲突](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T024/App036-PPTX-001-002/manifest.json)已由[Root合并核定](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-SystemKeys/App036-T009-T024-T133-final/manifest.json)收口T009/T024/T133；两次前置失败、额外按键、用户焦点确认及观察边界分列保留。其余原系统／外部／设备缺项继续，完整M12尚未验收或发布。


2026-11-08继续：[T146当前实际悬停观察](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P075/T146-App036-human-001-003/manifest.json)中，用户现场明确未见完整标题提示并提供截图；当前标题截断及地址滚动已验证，整条仍部分通过。原因待定位，原启动前错误、观察未知与本次负向证据分别保留；隔离App已正常退出并清场。下一步先做范围内实现诊断，不再重复要求用户悬停或改造取证驱动。


2026-11-08继续：[T146完整标题当前实际A](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P075/T146-App037-current-A001-003/manifest.json)已完成，原现场未见提示、软件竞态红与前置驱动红均保留；[source041–044软件及App037官方构建](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P075/T146-tooltip-software-App037-build-001/manifest.json)可追溯。当前候选App037的目录包已验收这项，安装包S6仍待；其他原系统／外部／设备缺项继续，尚未完整交付或发布。


当前T145[基本认证原四组合](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App039-auth4-root-composition/manifest.json)已补实际取证和逐图对照，原失焦与focus描边差异保留；完整视觉仍待。用户安排先完成T145，再补扩展外屏条件下T110；T141因暂无Intel真机先暂缓，不计通过。


2026-11-08当前批次更新：外接1080宿主状态、导航、站点权限与真实CLI活动／暂停已取得新的实际证据，具体结果和原失败见[本批执行记录](验收/执行与缺陷记录.md#2026-11-08-app041视觉批次-a015a016a020a021-与原失败保留)。外部应用提示视觉差异已定位，源码修正待新包复验；完整T145仍待。T110缺全屏／跨屏现场观察，已正常退出并后置；Intel T141按用户安排暂缓。完整M12及最终包验收尚未完成。


App042[外部应用提示实际原八组合复验](验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App042-external-A024-reviewed8/manifest.json)已完成，Root逐图确认本次宿主样式修复有效，原红与夹具差异保留。当前自有资源已收尾；暂停样式、原矩阵其它缺项及最终安装回归继续，T145仍待整条验收。


暂停接续：[本次暂停交接与部分产物](验收/证据/并行测试/M12-20261103T154320Z-bff2/pause-20261109-after-App048/manifest.json)。不自动恢复或重放旧输入。

恢复记录：2026-11-09用户将目标置active并要求继续；原暂停交接保留，未重放旧输入。
