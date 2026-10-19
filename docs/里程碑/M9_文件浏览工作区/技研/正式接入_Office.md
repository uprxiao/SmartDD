# M9 Office 正式接入

依据：需求 R3.4-P1 的 R06.8–R06.10、R07.11/12/16/18；沿用[开发前方案](开发前_04_Office.md)、[动作矩阵](实验/r34-office-actions-矩阵与验证.md)和[固定引擎资源](开发前_09_引擎资源.md)。本页记录生产接入，不改写前期实验或缩减动作范围。

## 当前实现

2026-10-17：开始 I06。生产目录 `src/main/core/files/office/` 已实现原始 ZIP 部件读取、实际解压大小与 CRC 校验、名称/链接/重名拒绝、不可变候选与逐部件变更计划核对；XML 使用带命名空间的 SAX 验证与原文范围补丁，保留未编辑前缀、空白、注释、未知属性、UTF-8/UTF-16 编码及 BOM。关系图只在包内解析，外部 URL 只保留为元数据。

四份既有真实 OOXML 合成样本（复杂工作簿、删除引用工作表后的工作簿、带图表/表格的演示稿、复选框工作簿）已通过新生产代码读取、关系检查、重新物化和全部部件 SHA-256 对比。17 项代码测试通过，日志 `/private/tmp/willyou-m9-office-base-r2-tests.log`；首轮 `_rels/.rels` 被通用文件扩展名函数误判的问题已修正，失败日志保留在 `willyou-m9-office-base-tests.log`。这不是 App 界面验收，也没有表示 Office 编辑或全部格式已接入。

## 工程预算与处理层次

2026-10-18 续接：真实 XLSX/XLSM 模型、分块读取、独立 Worker 和主进程按窗口/文档身份隔离的服务已接入。模型区分数值原文、布尔、字符串、错误、公式与缓存，保留全部原始部件；视口最多100×40，单格文本可分块取全。关闭/替换/根失效取消旧解析；工作队列与TeX共用。计算缓存提取只回填原包对应单元格的 `t/v`，核对公式与数组结果闭包，不采用引擎整包输出。32项Office代码测试通过（6文件，`/private/tmp/willyou-m9-office-calculation-r1-tests.log`）；另有控制器鉴权测试及类型检查通过。这些结果均不是真实App验收。

`pnpm files:prepare-office` 已按前期清单取得固定 JRE 和13个POI JAR，校验大小/哈希并保留原许可证；产物313文件、177666418字节。构建现在自动准备这些资源，主进程/预加载/渲染器本轮构建通过，日志 `/private/tmp/willyou-m9-office-core-build.log`。本机无javac的首轮失败保留；改用固定ECJ 3.43.0，由已下载JRE执行、禁用注解处理器。ECJ为构建工具，不打入App；SHA-256为`c786468c65e906498e7e36ece4e0d04c6d3dd34c9a61b34a3a5b512801911a82`，官方SHA-1另核对一致。来源与参数写在 `scripts/files/prepare-office.py`。[Eclipse官方批编译说明](https://help.eclipse.org/latest/topic/org.eclipse.jdt.doc.user/tasks/task-using_batch_compiler.htm)。

新生产Java helper已实际运行两份前期合成工作簿，3/15个公式重算成功；独立ZIP/XML回读确认错误引用和缓存，原件哈希不变。见[原始引擎结果](../验收/证据/m9-development-office-engine-20261018.json)。该次尚无原生沙箱封装或App界面，不能据此关闭端到端用例；完整LibreOffice、样式投影、编辑保存、原生进程生命周期与包内资源复验继续实施。

本批先冻结 ZIP/XML 处理预算（`src/shared/file-office.ts`），供后续 Worker 和候选引擎共同执行：输入/最终候选各 ≤40 MiB，展开总量 ≤256 MiB，单部件 ≤64 MiB，包内最多8192项，单 XML 最多500000节点/128层。校验实际流字节，不仅相信 ZIP 声明；压缩率高本身不代表恶意文件，不以压缩率单独拒绝。读取不解压到用户文件系统。

解析/物化必须在可销毁的 Worker 内，单请求15秒、旧代堆512 MiB；这些是生产工程限额，不是 Codex 测量值，也不代表目前已完成压力验收。后续基于视口请求单元格和对象，不能把大工作簿一次送入渲染器。重型 POI/LibreOffice/TeX 继续共用单作业队列，取消、根失效、旧版本和窗口销毁都终止所属工作。

POI 计算沿用已冻结的固定 Temurin JRE、`-Xmx512m`、20秒、RSS768 MiB及取消预算；LibreOffice沿用20秒、进程树RSS1 GiB和5秒取消。输入是主进程身份校验后的私有副本，helper不接收渲染器任意路径、命令或环境变量，不读取外部工作簿、不执行宏、不联网。引擎结果只提取操作声明的计算/布局字段，不能覆盖原包。

## 2026-10-18 原生封装及工作簿预览

生产原生 broker 已增加 Office 私有作业、固定资源校验、Seatbelt 内 POI 调用和回执核对。与 TeX 共用作业目录实现但使用独立标记/目录；同一重型作业队列、取消、超时、RSS 和遗留作业回收均有实际原生测试。独立 Java canary 实测外部文件读取/写入、其它程序执行和本机 TCP 连接均被拒绝；网络监听端实际收到0次连接。用户原件仍不交给引擎覆盖。

首轮 JRE 在沙箱内启动 SIGSEGV，崩溃栈位于 `os::init_system_properties_values`。结合 [OpenJDK 源码](https://raw.githubusercontent.com/openjdk/jdk21u/master/src/hotspot/os/bsd/os_bsd.cpp) 的 `realpath` 初始化路径推断为祖先目录元数据不可读；仅加入 runtime/job 祖先的 `file-read-metadata` 后正常启动，外部内容权限仍由 canary 证明被拒。第二个缺陷为 JRE 诊断输出与 JSON 回执混杂，改成唯一终止帧 `WILLYOU_OFFICE_RESULT`，保留诊断文本。首次失败及最终成功日志见[本批证据](../验收/证据/m9-development-office-preview-20261018.json)，不覆盖失败历史。

实际工作簿样式/主题色、数字与日期格式、共享公式显示、行列尺寸/隐藏、合并单元格和有界虚拟网格已接入。数值显示复用 Apache-2.0 的 `ssf 0.11.2`，原始数字词法内容不随显示格式转换；完整文本经分块复制。工作表切换、缩放、公式只读栏、键盘定位和旧响应取消已有组件测试。当前入口为阶段性只读预览；编辑、结构动作和保存继续实现，不能作为完整 M9 Office 交付。

本批合并测试60/60、14文件通过，其中 Office 原生6项、TeX原生回归7项；其它覆盖组件、Worker、候选保真和控制器。类型检查通过；共享公式的 TypeScript 收窄问题及修复保留日志。该组不是实际 App 验收。新包、完整样式/格式、性能、浅深色和全部动作仍待验。

## 接续顺序及未完成项

1. 完成真实文档模型、分页读取、Worker/IPC、取消与预算；将已确认 Office 原型控件绑定真实来源。
2. 按动作矩阵实现 XLSX/PPTX 局部操作、依赖闭包、完整撤销、计算与格式保真；DOCX 两种宿主路线、修订显示与条件评论分别接入。
3. 按固定哈希准备 JRE/POI/完整 LibreOffice；接入受限 helper、排版、资源读取及打包检查。
4. Office 生成候选、草稿/关闭 flush、串行保存与权威回执接入 R07.17 原生提交保护；签名/保护/未知依赖失败保留原件与草稿。
5. 执行全部约定动作与完整 App/外部 Office 重开/生命周期验收，保留失败、平台和视觉差异。

上列仍未完成的能力不能由基础库测试代替，不将临时只读入口或“能力未开启”作为最终交付。正式验收计数不变。

## 复用与来源

固定 `yauzl 3.4.0`、`yazl 3.3.1` 负责 ZIP 格式处理，沿用 `saxes 6.0.0` 解析 XML；依赖进入锁文件及 M9 许可清单。`yauzl` 不替调用者核对 CRC，因此生产层使用 Node `zlib.crc32` 对实际内容额外检查。[yauzl 官方说明](https://github.com/thejoshwolfe/yauzl#no-crc-32-checking)、[yazl 官方说明](https://github.com/thejoshwolfe/yazl)。

## 公式刷新生产接入（2026-10-18）

读取XLSX后由Worker生成私有计算输入，展开共享公式并补数组从属格；公式数量按完整结果集合计算。POI结束后只回填t/v，原共享/数组公式XML与未编辑部件保持。解析和原生计算分阶段取得同一队列，避免嵌套等待死锁；失败显示现有缓存与明确原因，来源失效取消旧计算。XLSM继续只读取缓存，不执行宏。App启动增加Office遗留作业清理。

原数组样本首次暴露从属格缺失及计数错误，修复后13项通过。扩展66项合跑时64通过、2失败：一个是包内JRE的jspawnhelper被签名改写后误拒，另一个为取消用例断言了中文文案而非CANCELLED码。修复后二个受影响测试文件14/14通过，实际运行原preview-r1包的固定JRE/broker成功；完整App签名仍验证，JAR/classes与数据继续精确哈希检查。类型检查通过；[所有批次证据](../验收/证据/m9-development-office-calculation-20261018.json)保留失败和测试层级，真实计算界面在新包中继续验收。

## 单元格编辑、历史和恢复接入（2026-10-18）

本批对应R06.8、R07.1/R07.2/R07.4–R07.6/R07.9/R07.10/R07.12/R07.16–R07.18。单元格修改仍由独立Worker持有完整OOXML包，精确修改目标格，失效公式及数组从属缓存、移除声明范围内的旧calcChain并设置读取方重算标志；共享字符串只更新引用数，未编辑的富字符串和未知部件不重写。修改共享公式组成员时只展开该组。数组单格修改、受保护sheet、签名文件当前拒绝；签名确认和结构/格式操作仍待接入，不以此缩减已确认范围。

ST_Xstring按[微软规范](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/bd0aa042-434a-4ca7-b25f-4e1fd25a954d)处理转义外观、CR、非法XML字符与孤立代理项；公式按XML字符串处理，不作ST_Xstring二次解码。前导零和超过15位有效数字的输入保留为文本，显式单引号可保留文本类型。类型检查发现String.isWellFormed不在既定ES2022类型库中，改用Unicode模式校验孤立代理项，并覆盖合法emoji/非法代理项。

文档会话改为窗口+文档实例隔离，视图卸载不关闭Worker。撤销历史复用未修改部件，最多200个状态，历史额外持有部件64MiB；计算缓存不制造用户编辑。物化快照绑定模型版本和SHA-256，保存ack不能清除另一份快照。四个活动Office会话上限继续沿用，达到上限明确失败而不淘汰dirty文档。

独立Office草稿采用WYOFFICE1二进制信封：原格式候选字节加受限JSON中的未提交单元格文字；它不是可直接写回源文件的Office候选。候选40MiB、信封41MiB，原文本草稿仍20MiB；原生checkpoint、校验和恢复按各自预算执行。大草稿经身份/哈希绑定的1MiB分块读取。保存前先持久化草稿，然后调用原有FileService/native broker版本校验提交，成功回执分别关联源候选哈希与草稿信封哈希。外改保留本地文档，显式保留本地才更新保存基线。

前端FileBuffer拥有OfficeBuffer，pending公式输入即dirty，500ms草稿、3s自动保存；手动保存/关闭先flush，组合输入期间不提交。迟到保存不能清除新输入。用户明确放弃只解决当前普通草稿，不删除未解决的原生保存恢复物。真实磁盘冲突、21MiB草稿及候选保存已在原生测试复验。测试与失败历史见[本批记录](../验收/证据/m9-development-office-cell-20261018.json)：32项模型/缓冲区、29项界面/控制器、11项Office原生、5项选定草稿原生通过；测试层级分别保留，不将这些数值相加冒充正式用例数。

cell-r1应用目录已构建，asar为3e20ac7e47b4b4eef16124c2afb2ae32486635387c3b63af117c1e0059773503，正在做真实App编辑/保存/恢复复验。仍需完成表格内原位编辑、范围/批量操作、全部结构/格式、数字签名交互和完整浅深色/焦点/IME矩阵；已批准原型的这些能力保持待实现，不能宣称像素完全一致。


cell-r2真实App已完成不完整公式的草稿落盘/异常退出/手动重开恢复，以及冲突后继续编辑/保留本地原复现步骤；M9-DEV-011/012关闭边界见证据。新发现标签快照未及时落盘，按[标签持久化修复](正式接入_标签持久化.md)单列M9-DEV-013。根失效后的就绪Worker仍可保留本地模型/独立草稿，计算与源写入停止；文档关闭仍释放Worker，原生测试已覆盖。


## 原位单元格编辑（2026-10-18）

沿用R3.4-P1，增加网格内双击/F2/Enter/键入/粘贴编辑、Enter/Tab/Shift+Tab提交后定位及Escape取消。未提交文字仍进入同一OfficeBuffer独立草稿；输入框保留本地文字和模型基线版本，避免原位保存后继续输入被旧单元格值覆盖，或改回保存前的值被误判没有修改。组合输入只加事件门禁，不能替代物理输入法验收。迟到单元格读取和旧blur不覆盖新编辑意图。

18项相关代码测试及类型检查通过，inline-r1实际打包及SQLite/PTY/voice/file broker/watcher检查通过。真实原位界面复验因Mac锁屏尚未执行；完整范围/格式/结构操作继续，正式验收仍3/419。[本批证据及失败历史](../验收/证据/m9-development-office-inline-20261018.json)。


## 公式语法与输入类型保护（2026-10-18）

代码审查发现M9-DEV-014：标量解析只检查公式非空/长度/XML字符，`=SUM(`可进入模型；重算失败只保留错误信息，保存仍可能写入该公式。未伪造修复前真实App复现，新增真实原生负例证明修复后的拒绝/恢复行为。

新公式提交前，以固定POI FormulaParser在私有工作簿副本的正确sheet/row上下文解析。复用同一个有界JRE、Seatbelt、进程/作业清理；固定`office-validate`协议只接收主进程准备的包和有界公式列表，文字经UTF-8/base64写入私有请求文件，不拼接命令或表达式求值。校验不执行公式、不写工作簿、不打开外链、不运行宏。最多10000条/8MiB请求，沿用20秒和768MiB运行限制；这是工程预算而非兼容性完成声明。

保存前Worker按sheet身份、地址、公式及表名与已保存基线比较，对变化公式复验，覆盖从旧版本恢复的非法模型草稿。校验失败前先保存独立草稿；未修改的源公式保留，不因其计算器兼容性阻止无关数值修改。撤销、重做和保存回执同步基线。原始输入中的TRUE/FALSE字面文字不自动变为布尔；仅已有布尔类型按其原类型改值，显式单引号保留文字。真实checkbox仍待实现。

解析器会对不支持的语法抛错，且未知UDF可能在私有解析副本中创建名称，因此错误文案明确为“未通过当前引擎校验”，不把所有拒绝都认定为Excel非法语法；这些副作用不会进入源候选。[Apache POI公式解析API](https://poi.apache.org/apidocs/dev/org/apache/poi/ss/formula/class-use/FormulaParsingWorkbook.html)、[解析异常定义](https://svn-master.apache.org/repos/asf/poi/site/publish/apidocs/dev/org/apache/poi/ss/formula/package-summary.html)。

41项模型/组件/真实原生测试通过，包内引擎用例因新包尚未完成暂跳过；首轮无汇总的运行不计通过。原位编辑和公式真实App继续等待解锁。[证据和具体边界](../验收/证据/m9-development-office-formula-20261018.json)。

公式formula-r1包（asar `a844e2edea7bcf11a68f9c32e49e35cb4dc23ccc84d6ae13be2e40bbd4787d9f`）构建及原生检查通过；选定的包内实际JRE/broker用例通过正常计算、合法解析及非法语法拒绝，另12个非选定用例未重复执行。新增文字/布尔真实OOXML往返测试后cell-edit文件6/6通过。实际App交互仍未执行。


## 工作表新增与排序（2026-10-18）

X12/X14已接入Worker、可信IPC及表格底栏：新增真实空worksheet，分配无碰撞的sheetId/rId/部件名，登记关系和Content Types；排序保持原sheet节点内容、稳定身份及各worksheet字节，重映射definedName.localSheetId和各workbookView的activeTab/firstSheet（含隐式默认0）。customWorkbookView.activeSheetId是稳定sheetId，不作位置重映射；依据[微软WorkbookView](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.workbookview?view=openxml-3.0.1)和[CustomWorkbookView](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.customworkbookview?view=openxml-2.20.0)。结构保护与只读来源分别拒绝；当前只接入xlsx，签名交互等尚未完成。

沿用此前结构实验的关系/候选清单路线，生产代码改为原XML范围补丁；不是直接运行实验脚本。calcPr在正确schema位置插入，此修正同时覆盖普通单元格保存；重算结果仍只回填声明缓存。前端先flush当前输入，再执行新增/拖排；新表自动选择，拖排不改变当前查看身份，撤销新增后回落到有效可见表。完整视图/选区历史仍需继续。

37项相关代码测试、类型检查通过；选定真实原生用例验证新增/排序/计算/保存/关闭重开及逐部件保全。新包构建中，Mac锁屏使真实界面未执行；原型已有新增/拖排入口，本批只接入其对应行为，没有改写历史原型验收结论。重命名、删除、范围/格式、对象等保持待实现。[源快照、失败历史与测试证据](../验收/证据/m9-development-office-sheets-20261018.json)。

工作表sheets-r1实际包已构建，asar `2b06db62a0b68a3b8d3476ec2cd19b381c782efb36634c6afd121fa3311e0970`；SQLite/PTY/voice/file broker/watcher全部通过。实际App交互仍待解锁，不能把原生重开当作界面验证。

## 工作表重命名（2026-10-18）

X13沿用开发前依赖适配路线，生产TS词法适配仅修改工作表引用操作数，保留字符串、外部工作簿引用、结构化选择器、空白及未编辑公式。重命名覆盖直接/双端范围、3D端点、共享/数组公式、局部名称、图表公式、内部超链接与pivot worksheetSource；稳定sheetId/rId不变。未知公式命名空间/存储类型明确失败并保留模型，尚不能据此宣布全兼容。POI只负责私有计算，不复制其setSheetName重写后的整包或公式（前期样本会将结构化引用变成固定区域）。

双击sheet经flush打开沿用原型尺寸的名称弹窗，取消不改文档；无效/重复名保留输入与错误，组合输入不提前提交。真实系统IME与弹窗焦点尚待实际App验证，右键菜单随删除动作接续。提取共享mutation收尾逻辑，统一失效公式/数组缓存和calcChain，未修改部件继续逐字节保留。

45项相关代码测试、类型检查通过；8个表名变体各核对15项实际引擎公式/数组结果。原生全跑13通过、1失败、1包内引擎项未执行；失败来自测试未列入应变更的图表引用部件。补充精确图表引用及其余内容不变断言后，选定新增/排序/重命名/保存/关闭重开用例通过，其余14项未重复执行。源快照和失败历史见[本批证据](../验收/证据/m9-development-office-rename-20261018.json)。新包将合入后续删除动作，实际App继续等待解锁，正式3/419不变。


## 工作表删除与菜单（2026-10-18）

X15/X16接入稳定sheet身份的删除操作：先移除workbook声明/关系，再计算该表依赖闭包；从剩余图及原有独立部件仍可达的资源保留，不能因恰好在删除候选闭包就删共享chart/media。只移除已注册关系类型的私有部件与Content Types，未知私有依赖返回具体错误。局部definedName删除或重编号，workbookView序号映射及customWorkbookView稳定ID分别处理；最后一张可见表在主进程和菜单双层保护。

与重命名共用精确依赖适配，删除的直接/区域/表名及结构化引用变为失效引用，3D区间按剩余sheet收缩，字符串常量保留。图表被其他绘图共享时保留部件，改写其引用并清除失效引用对应的旧缓存；共享字符串不压缩，只有可选count更新。完整候选继续失效单元格/数组缓存并调用固定POI重算，只回填t/v。支持仅以表名引用数据的形式，依据[微软结构化引用说明](https://support.microsoft.com/en-us/excel/using-structured-references-with-excel-tables)。数据透视缓存仍指向被删sheet时明确拒绝，后续适配保持未完成，不能以这个保护代表该分支完成；其关系模型参考[微软PivotTables说明](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-pivottables)。

正式UI沿用原型的查看/重命名/删除菜单，接入鼠标右键和键盘ContextMenu/Shift+F10；只读仍可选sheet，结构动作受lockStructure约束，sheet内容保护不误禁工作簿结构动作。双击与菜单共用重命名弹窗；删非当前表保留当前查看身份，删当前表回落相邻可见表。空workbookProtection节点不等于锁定结构。

模型测试覆盖私有删除、共享chart保留、局部名称/视图、sharedStrings计数、未知依赖/最后可见表保护以及全包撤销重做；界面组件11项通过。首次UI两项失败属于ResizeObserver测试桩和菜单查询范围，修正后复验通过。真实原生测试先记录错误的测试调用顺序/数字词法断言，修正后两项通过：Worker删除→重算→原生保存→重开→撤销并再保存，以及8组表名各15项公式/数组结果；补裸表名引用后复验相关原生用例通过。类型检查通过，完整源快照、日志及各层边界见[本批证据](../验收/证据/m9-development-office-delete-20261018.json)。

structure-r1包构建中；实际App仍因Mac锁屏未执行，正式3/419不变。完整选区/视图历史、范围/格式/对象、签名及DOCX/PPTX继续。


structure-r1本机应用目录构建和包内原生检查已通过，asar SHA-256 `763be44a9f48767e8f6402e301c4cf46dfc997739dfc8cc9426bf263c0dceb7d`；包含重命名与删除增量。实际App操作尚未执行，仍等待解锁。


## 范围操作与视图历史（2026-10-18）

沿用 R3.4-P1 的 X05–X07 范围动作及 W24/W25 工具矩阵，接入 Shift+点击/键盘、指针拖选、完整 TSV 复制和模型统计；范围信息不依赖当前虚拟视口。菜单沿用已确认原型的填充、合并/取消合并、三种清除入口，当前未接入的 fit/格式面板继续实施。读取/动作单次 10000 格，复制按实际 UTF-8 TSV 字节最多 8 MiB，超限说明原因而不截断；这是本批工程预算。

主进程核对 owner、只读来源与版本；Worker 先生成私有候选，对变化公式经固定原生解析器验证后才一次提交。失败不改变历史/模型；清理候选并允许重试。填充从原始首行/首列取值，按相对/绝对地址平移公式，保留数值/布尔/错误/日期和富文本子树命名空间，不级联使用已填的目标；受影响共享公式组显式展开。内容、格式、全部清除分开；完整数组可清除，部分数组/部分合并及不支持公式类型明确拒绝。合并保留覆盖格原值，取消合并不重建包。原部件精确补丁，一批动作一个可撤销历史；未涉及的对象/关系/元数据保留。

OfficeBuffer 在成功版本边界保存工作表身份、锚点、范围端点及缩放，撤销/重做恢复对应视图；拒绝/空动作不增加视图历史，底层裁剪历史时同步清理。右键先完成当前输入再定位范围，非法公式保持原输入与选区；选区统计显示在原型的 sheet 底栏位置。原型已有对应状态，本批为真实接入而非新增产品布局。

本批39/39相关代码测试和类型检查通过；选定真实原生用例完成公式填充→重算→合并→原生保存→关闭重开→取消合并/清除→再次保存，逐部件比较通过；17个非选定原生用例未重复执行。早期失败、快照与日志见[范围证据](../验收/证据/m9-development-office-range-20261018.json)。range-r1包构建中，真实App因Mac锁屏未执行；正式3/419不变。行/列继承格式显示与清除、格式面板/fit/校验/对象等未完成，后续按原范围接续。


range-r1本机应用目录构建与包内SQLite/PTY/voice/fileBroker/fileWatcher检查通过；asar SHA-256 `7c408ff9a799545a1a7269178ec18c171f440a100a2f7d313d418aabe3777409`。真实App仍待工具解锁后验收，正式3/419不变。

## 单元格格式与富文本（2026-10-18）

沿用 R3.4-P1 和已确认格式面板，接入字体、字号、粗斜体/下划线/删除线、文字色、填充、水平对齐/换行、边框、数字格式和小数位。格式操作使用既有范围候选与单次撤销链，保留真实数值、公式和未涉及部件；字体、填充、边框、xf 与数字格式按语义去重后追加，不直接修改被邻格共享的定义。字体属性变更同时精确更新所选富文本的对应 run 属性，共享字符串写入新条目，未选择的引用及未知元数据保留。清除格式恢复默认样式，包含行/列继承和富文本覆盖。

投影遵循明确 cell s、column 默认、row customFormat、默认样式的顺序。这里依据固定读取引擎公开的 [POI XSSFCell 行列样式回退](https://poi.apache.org/apidocs/dev/org/apache/poi/xssf/usermodel/XSSFCell.html)，不推定所有表格软件版本已互验；XML 字段依据 [CellFormat](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.cellformat?view=openxml-3.0.1)、[Column](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.column?view=openxml-3.0.1) 和 [Row](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.row?view=openxml-3.0.1)。显式 apply=0 从父 xf 继承，修改后将对应 apply 置为 1。自定义/日期格式保持原样；仅调整其小数位时明确拒绝，用户可显式选择标准数值格式。格式变更保留缓存，样式依赖公式的完整兼容性仍需后续矩阵验证。

富文本窗口按 run 显示实际字体属性，预算为 8192 runs、262144 总字符和单格 16384 字符；截断明确标记，完整文本仍从模型复制。格式面板沿用原型尺寸和控件顺序，字号显示 CSS px、写入 OOXML points；输入框保留原生撤销，格式区 Cmd+S 先完成当前字段再保存。原生颜色选择器、真实系统 IME 和完整焦点流程尚未实机验收。

116/116 Office 代码测试、类型检查通过；2 个选定真实原生用例通过独立 POI 读取、原生保存/关闭重开及范围回归，另 17 个未选定用例未重复执行。中间失败与修正、源快照及日志见[格式批次证据](../验收/证据/m9-development-office-format-20261018.json)。format-r1 包构建中；真实 App 仍因工具报告 Mac 锁屏未执行，正式 3/419 不变。fit、校验、条件格式、复选框、对象、签名与 DOCX/PPTX 等继续。


format-r1 本机应用目录构建及包内原生检查通过；asar SHA-256 `78afe13dd01db1950ab3a23c0fce4cd9b17fc03bfcfd0dfea6be9392874e2f23`。实际 App 尚未执行，正式 3/419 不变。

## 实际字体测量与行列尺寸（2026-10-18）

X08 按已有原型作用于所选整行/整列的已用内容，不只读取当前选区或虚拟窗口。Worker 提供真实显示文本、富文本字体、换行和合并宽度上下文，固定 native broker 使用本机 Core Text 排版；指定字体或字体样式缺失时明确失败。禁用字体自动激活，不下载字体；CJK/emoji 的系统字形回退参与真实测量，记录实际字体名。处理过程不接收文档路径、URL 或任意可执行代码。依据 [Apple CTFont 选项](https://developer.apple.com/documentation/coretext/ctfontoptions/preventautoactivation)、[CTTypesetter 行切分](https://developer.apple.com/documentation/coretext/cttypesettersuggestlinebreak(_:_:_:)) 和 [CTLine 字体边界](https://developer.apple.com/documentation/coretext/ctlinegettypographicbounds(_:_:_:_:))。

精确修改目标 worksheet 的列宽/行高及对应 customWidth/bestFit/customHeight，拆分跨越选区的 col 定义，保留格式、分组、隐藏和未知属性；合并区域按共同可见尺寸形成约束，只调整所选轴，覆盖格原值保留。空行使用实际默认字体行高，空列保留原宽。测量沿用实际 App 的文字内边距与行高，不以字符数代替字形宽度。显示按缩放同步文字内边距。竖排 rotation=255 明确拒绝；复杂旋转、缩小字体等排版矩阵仍待专项验证。

代码对照规范发现 M9-DEV-015：原列宽投影把 OOXML 已含边距的 width 又加 5 px，且固定使用 7 px 最大数字宽度。现按 [微软 Column 换算式](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.column?view=openxml-3.0.1)修正，并在打开/重开时测量 Normal 字体；缺字体时预览给出兼容尺寸提示，fit 保留原尺寸并失败。默认宽度按 [SheetFormatProperties](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.sheetformatproperties?view=openxml-3.0.1)处理。固定样本 8.7109375×7 对应 61 px 已验证；原 12/24 单位投影从 89/173 修正为 84/168 px，不把旧错误断言继续当规范。

测量预算为 10000 个内容格/目标轴、1 Mi UTF-16 字符、16384 个富文本段、50000 个合并覆盖格、8 MiB 请求和 10 秒原生调用；超限/失败不改历史或尺寸。119 项 Office 代码回归通过；增加输入排空→测量失败保留→重试→撤销尺寸组件用例后，该文件 18/18 通过；类型检查通过。2 项真实原生用例验证不同字形宽度、字号、中文/emoji/富文本/换行、缺字体拒绝、精确保存与独立 POI 重开读取，另 19 项未选定。源码、失败记录见[fit 证据](../验收/证据/m9-development-office-fit-20261018.json)。fit-r1 构建中，实际 App 仍待解锁；正式 3/419 不变。


fit-r1 本机应用目录及包内原生检查通过；asar SHA-256 `c88d38b21588a93103701c48f81b6719008539f4c9d7234ea2561eb149996849`。真实 App 尚未执行，正式 3/419 不变。


## 数据验证正式接入（2026-10-18）

沿用 R3.4-P1、R06.8/R07.2/R07.16/R07.18，工具矩阵 X09 对应 W24/W26/Y13（不是 M9-T-X09）。已确认面板的“不限制／数字或公式”进入真实模型；新增规则为标准 `dataValidation type=custom`，公式 `OR(ISBLANK(B2),ISNUMBER(B2),_xlfn.ISFORMULA(B2))`，显式允许空值、启用 stop 错误。原值不被清空，后续键盘/公式栏/填充/清除均走同一检查。文字数字、长编号和前导零保持字符串语义，公式允许任意结果类型。

只修改选区与相交规则；范围外矩形保留，拆分后相对 formula1/2 根据新锚点平移，绝对引用/未知 XML/外围属性保留。规则带不可拆分扩展身份或相交 x14 规则时明确拒绝。旧常量 whole/decimal/textLength/list 规则可校验，任意公式和需警告确认的已有规则尚未完整适配，不消费输入、不擦除原规则；未开启错误提示的规则保留其行为。预算 4096 条规则、16384 个引用、单次 10000 格。

依据 [微软 DataValidation 属性](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.datavalidation?view=openxml-3.0.1)、[未来函数列表中的 _xlfn.ISFORMULA](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-xlsx/5d1b6d44-6fc1-4ecd-8fef-0b27406cc2bf)。125 项代码回归、类型检查和 1 项选定原生保存/POI 回读/重开通过。原生首轮漏调用显式重算，次轮对比未计入既定 calcPr 更新，均修正测试并保留失败。实际 App、Excel/LibreOffice 界面及完整规则兼容矩阵未执行，未宣称完成；[证据与源快照](../验收/证据/m9-development-office-validation-20261018.json)。


## 条件填充正式接入（2026-10-18）

R3.4-P1 工具矩阵 X10，映射 W24/W26/Y13。生产条件填充输入保留已确认原型位置、数值输入和清空取消行为；输入在 Enter/失焦提交，保留输入中的临时值与原生撤销，明确拒绝非有限值。选区生成标准 expression 规则 `AND(ISNUMBER(B2),B2>阈值)` 与纯填充 dxf（`#fff0c8`），不改原有 cell 样式，不把 CSS 颜色当文件状态。阈值 0/负值有效；文字数字不强制转型；公式按重算后的类型/值显示。

变更只拆分所选范围中的已支持阈值规则，相对锚点同步调整。范围外规则的 priority、stopIfTrue、XML 顺序及未知内容保留；新规则使用未占用的末尾优先级，dxf 去重复用。已存在常量数字 cellIs + 纯填充按优先级显示；不支持的规则/扩展或冲突显式提示并保留原件，不将保护性拒绝计为完整兼容。依据 [微软 cfRule 定义](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.conditionalformattingrule?view=openxml-3.0.1)与 [dxf 定义](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.differentialformat?view=openxml-3.0.1)。

109 项非 preview 回归与最终 20 项组件测试通过；初轮发现 background/backgroundColor 混用警告，已统一属性。初两轮末尾断言早于异步视口刷新，修正等待实际 DOM 后通过。2 项选定真实原生用例覆盖本批条件格式和数据验证回归，独立 POI 读取规则并实际计算数值／文字谓词。源码与日志见[证据](../验收/证据/m9-development-office-conditional-20261018.json)。conditional-r1 本机包已通过构建/原生检查；实际 App 仍待解锁后验收，正式 3/419 不变。


## X11：旧式表单复选框

2026-10-18，依据 R3.4-P1 R06.8/R07.16/R07.18。`checkbox.ts` 将 worksheet control、ctrlProps、VML shape 和当前表单格 Boolean 做一致性检查；实际控件锚点与绑定格独立。普通 Boolean 编辑和控件点击经过同一事务，同步 cell、ctrlProps 的 checked 与 VML Checked；格式/未知 XML/标签/锚点和无关部件保留。改工作表名称同步两类绑定声明。复用未提交输入串行队列，不让勾选丢掉另一格的待提交文字。

`checkbox-edit.ts` 按已验证的完整控件结构生成 ctrlProps、VML、DrawingML 兼容表示、worksheet control/anchor、关系与内容类型；复用已有绘图容器，保持原图表/评论/对象字节，仅追加控件。范围写 Boolean、共享字符串计数、公式缓存失效和这些新增部件一次提交，可一起撤销；已有同格控件不重复生成。4096/表、512/可见投影预算明确；XML 与 VML 索引复用，1024 控件测试通过。

仅承诺本批已验证的单表、非 ActiveX、二态 Boolean 绑定。三态、宏绑定、命名/跨表绑定、未知旧式或现代控件族、冲突状态及共享控制部件保留并禁用或阻止影响绑定的编辑；原生标签全部字体和复杂几何仍待适配。这些不是移出 M9 的范围豁免。

验证：142 项代码回归、类型检查、2 项原生保存重开、4 份 LibreOffice 独立读取通过；[完整证据/失败记录](../验收/证据/m9-development-office-checkbox-20261018.json)。独立读取使用原签名的 26.2.4.2 soffice CLI、副本及独立配置。其导出把 Boolean 正规化为 TRUE()/FALSE() 并调整部分锚点，故只核对实际控件/绑定/状态，绝不将整包导出用作生产写回。直接运行自带 Python 的系统启动约束未解决，UNO Python 检查仍为未通过；与 App 端到端分开。

官方字段依据：[FormControlProperties](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.office2010.excel.formcontrolproperties?view=openxml-3.0.1)、[Control](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.control?view=openxml-3.0.1)。本轮核对 [MacroExecMode](https://api.libreoffice.org/docs/idl/ref/namespacecom_1_1sun_1_1star_1_1document_1_1MacroExecMode.html) 后，将当前前期实验脚本的旧值 4 修正为 NEVER_EXECUTE=0；不重写历史实验结果。独立 CLI 使用固定包中 registry schema 的 DisableMacrosExecution=true，源文件有宏或外部工作簿则拒绝此测试工具输入；它不是生产隔离边界。


## 固定文档排版组件（2026-10-18）

依据 R3.4-P1 的 R06.9/R06.10/R07.18，完整嵌入 LibreOffice 26.2.4.2 原厂应用（build 0229ac93fcf0d7cbc6376066c6f35021cef002dc），固定 DMG 哈希、资源清单与 Team 7P5S3ZLCN7；打包保留原厂代码签名，外层 WillYou 签名同时校验。每次运行核对全部文件、链接、目录权限、身份与内容；不使用本机已安装应用，不运行时下载。NOTICE 记录原许可、完整版权声明和官方源码地址。

排版仅生成私有副本 PDF，不能作为 OOXML 保存候选。独立 Worker 校验包与 XML 后，固定 native helper 在共享单任务队列中运行 soffice；私有 profile 禁用宏，Seatbelt 限制到运行库、系统字体/动态库、输入副本、输出、临时目录和私有 OSL UNIX socket。只开放启动所需的两个 Mach 服务名；TCP、无关 UNIX socket、用户其他文件、运行库写入与其他程序执行均由真实独立 canary 验证拒绝。20 秒排版、1 GiB 子进程树 RSS、40 MiB PDF、2000 页和 128 MiB 临时空间预算；取消杀整个作业进程组，清理只接受受控目录及其持有者身份。

保留原始失败：签名表达式缺少前导等号、AppKit 所需服务拒绝、OSL 默认公共管道失败、Seatbelt 条件拼写错误；修复后 18 项代码、6 项原生及 1 项真实包内转换测试通过。包内 DOCX/PPTX 实测约 2.7/2.6 秒；这些是组件集成结果，不能替代实际页面或格式保真矩阵。原始日志、哈希和完整边界见[证据](../验收/证据/m9-development-office-layout-20261018.json)。

后续页面接入将显式设置 PDF `ExportHiddenSlides=true`、`ExportNotesPages=false`，使源幻灯片与 PDF 页面一一对应，备注单独取 OOXML 元数据。参数依据 [LibreOffice 官方 PDF 命令行说明](https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html)，本次包尚未包含此增量，需独立复验。DOCX/PPTX 业务模型、编辑保存和真实 App 矩阵继续实施。


## DOCX/PPTX 页面服务与宿主接入（2026-10-18）

`OfficePagesModel` 验证全包 XML 与关系图，保留真实 slide id/order/show、画布尺寸和 speaker notes；备注排除页码/页眉等占位符。读取来源只能是持有者已打开的 FileRef，完整内容哈希在 Worker 再核对，排版结束后重新读取 1 字节并由 native 校验原 revision 的身份/mtime/ctime，防止事件尚未送达时显示过期结果。PDF 只以持有者专属 id 分块暴露，renderer 再核对哈希。切文件/换根/取消/失效来源释放 Worker、进程、PDF 与请求，不接任意路径或 renderer 原始 Office bytes。

`OfficeWorkerClient` 复用已有 XLSX Worker 的 15 秒/512 MiB 与待处理队列生命周期；页面解析和 LibreOffice 分别持有共享 heavy-job 槽位，避免嵌套等待。预览沿用已确认原型：默认 DOCX 只读内容/Zoom/Fit，无页面栏；PPTX 缩略图/网格/单页/非编辑备注与既有快捷键。真实 PDF 页像素和尺寸取代合成模型，正文/缩略图/网格均限制绘制范围，继续使用 PDF 总画布预算。共用文件动作保持外层入口。

当前是原范围内的分步实现，PPTX 编辑、对象、结构、草稿/保存/冲突和条件 DOCX 路线尚未完成；不是将本期缩为只读。代码/原生结果和打包边界见[本批证据](../验收/证据/m9-development-office-pages-20261018.json)。真实 App 浅深色、微交互和精确尺寸仍未验收，不能声称与 Codex 完全一致。


## PPTX 编辑模型与保存（2026-10-18）

依据 R3.4-P1 R06.10/R07.11 与既有 P01–P15 动作矩阵。本批实现 P04、P05、P06 的基础适配，不减少剩余动作：目标 slide 的 show 属性、notes 正文普通段落/runs 和新 notes 的 backref/master/Content Types、局部纯色背景。未编辑部件按原字节保留；notes 页码/页眉占位符不作为正文。复杂字段、软换行、共享或多正文备注暂时明确拒绝修改并保留原内容，不能据此声称完整备注矩阵完成。结构依据 [Microsoft notes 文档](https://learn.microsoft.com/en-us/office/open-xml/presentation/working-with-notes-slides)与[DrawingML 段落](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.paragraph?view=openxml-3.0.1)，已完成事实以本批真实回读为准。

`PptxDocument` 在隔离 Worker 中持有不可变候选，复用既有 40 MiB ZIP、15 秒/512 MiB Worker、200 状态/额外 64 MiB 历史预算。物化捕获对应历史身份，并在异步压缩后重查版本。文档模型归 FileBuffer，而 PDF 预览归单次请求：视图卸载或取消排版不删除未保存模型；更新期间旧 PDF/迟到结果不可转为新版本页面。源根断开后就绪模型仍可做独立草稿，文件或窗口关闭则释放 Worker。现有 `LibreOfficeEngine` 在同一全局重型队列上生成 PDF，候选保存不使用其 OOXML 输出。

`WYPPTX1` 草稿封套包含精确候选字节及未提交备注，沿 `ooxml-draft` 的 41 MiB 存储预算；备注最多65536 UTF-16单位，头部≤256 KiB。原始组合输入及暂时无效 XML 字符可以进入私有草稿；应用修改时才执行 XML 校验。500ms 自动保存与草稿检查串行，保存失败暂停自动重试；用户显式保存可重试。保存前 checkpoint，再用 FileService/native 既有 baseHash/opId 契约提交；仅匹配候选哈希的回执可确认历史位置、解决对应草稿。新输入和旧回执分别保留，不因旧写入完成清除新 dirty。外改冲突暂停写入，显式保留本地时刷新基线并再次执行原生 compare-before-save。

渲染器沿用已批准共享 Office 原型的编辑/完成、备注、显示/隐藏菜单、背景面板和撤销重做；没有接入的复制/删除/插入等仍是本阶段未完成工作。当前背景读值只识别明确局部 srgb，不将未知主题/图片背景误报为已解析纯色；完整继承投影仍待适配。备注输入在 PDF 重新生成时保留同一 DOM 焦点，原生颜色控件复用已修正的 final change/blur 提交边界。组合事件测试是代码证据，不代替系统物理输入法。

[本批证据](../验收/证据/m9-development-office-pptx-20261018.json)包括232项回归、后续15项生命周期/鉴权回归、1项真实原生/独立 ZIP/XML 回读以及保留的测试 fixture/类型错误。新包构建和实际 App 待完成；正式用例数不变。


## PPTX 幻灯片结构与依赖（2026-10-18）

依据 R3.4-P1、R06.10/R07.2/R07.11/R07.16/R07.18 及已确认共享原型，P01 新增在末尾并选中新页，复用当前页的实际 layout，创建空占位符而不复制原页正文；P02 在来源页后插入副本，独立复制备注、图表、嵌入工作簿及其他可变依赖，安全共享 layout/master/theme 与媒体。关系 ID 在新部件内保留，目标重映射，备注 backref 指向新页；编码路径按 OPC 规范化身份避让已有部件。原 layout/master/theme 字节不改。

P03 删除先分析关系图，清理主列表、自定义放映、p14 章节 ID、已适配的页间超链接与仅该页拥有的依赖；共享资源保留，空章节保留。最后一页禁删，未知页引用、歧义共享备注等不提交部分修改。全包类型、关系和 XML 在候选完成后重新验证，未编辑部件保持原字节。资料依据为 [Microsoft 删除示例](https://learn.microsoft.com/en-us/office/open-xml/presentation/how-to-delete-a-slide-from-a-presentation)、[新增与 layout 示例](https://learn.microsoft.com/en-us/office/open-xml/presentation/how-to-insert-a-new-slide-into-a-presentation)和 [p14 章节列表模式](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/cc915728-85a4-46a0-a07c-eb5416a5762e)；新增位置以本项目已确认原型为准，不照搬示例的插入位置。

结构动作进入同一 Worker 历史、草稿、原生保存和重开链。renderer 在结构动作前提交备注；组合输入或验证失败时不继续改变页结构。选中页按稳定 ID 保持，删除当前页回到首个有效页，新增选中末页；撤销/重做同步页和缩放历史。缩略图、网格的可见范围在页数减少时重新夹紧，不出现负长度或越界页。保存失败仍停止自动重试并保留错误，显式保存可重试。

246 项相关代码回归通过，38 项 opt-in 用例未在该命令执行；另 1 项真实 Worker/原生测试通过，9 项未选定。实际排版得到 4 页，独立 Poppler 对原页/副本的 PNG 哈希相同；Python ZIP/XML 独立确认副本 notes/chart/workbook 分离，删除新增页与副本、保存/重开后 48 个原始部件的字节哈希完全相同。仅证明这份合成样本和所列场景，不证明任意 master/动画/扩展保真。完整结果、源快照和当前包状态见[结构证据](../验收/证据/m9-development-office-pptx-structure-20261018.json)。真实 App 因工具锁屏未执行，正式 3/419 不变；P07–P15 和其余范围继续。


## PPTX 对象模型与局部编辑基础（2026-10-18）

沿用 R3.4-P1 P07/P11/P12/P14，当前仅接入正式模型/Worker 与原生保存，尚未接对象操作界面，不标记动作矩阵全部完成。对象元数据取自真实 `cNvPr`、正文、`xfrm`、表格/图表节点，保留父 group 身份；source 坐标以点表示、落盘为 EMU，旋转落盘为 1/60000 度，未知继承坐标不造矩形。完整元数据序列化后限 2 MiB UTF-8，避免对象/正文扩展无限 IPC 载荷。

P07 创建真实 textbox/preset shape 及唯一 ID，11 种原型形状对应 rect/ellipse/triangle/diamond/star5/rightArrow/leftArrow/plus/chevron/wedgeRectCallout/line；水平线为零高度、实际线条属性。P11 普通正文复用精确段落/run 修改，保留未编辑样式、中文与 emoji；复杂字段/软换行仍留作适配缺项。P12 当前只修改明确已有的变换，保留 flip 与组的 child 坐标；不把组内坐标冒充全页坐标。P14 只在原父级重排，边界动作不产生历史，未知绘制节点暂时拒绝。结构依据 [Microsoft Shape](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.shape?view=openxml-3.0.1)、[Transform2D](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.transform2d?view=openxml-3.0.1)与[预设几何枚举](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.shapetypevalues?view=openxml-3.0.1)。

255 项相关代码回归、类型检查通过；40 项 opt-in 未执行。真实 Worker/原生排版/保存 1 项通过、10 项未选定：插入 11 种形状、中文/emoji 文本，更新位置/旋转/层级；独立 PDF 内容流与 ZIP/XML 核对，完整撤销后原 48 部件恢复。布局顺序抽取旋转重叠文字的原失败保留，改用内容流核验，不以字符核验代替外观检查。已查看[排版投影](../验收/证据/development-pptx-objects/pptx-objects-page1.png)，是故意重叠摆放的合成文件，非 App 截图。详情及未完成项见[对象基础证据](../验收/证据/m9-development-office-pptx-objects-20261018.json)。尚未为此增量打包；实际 App、继承/组坐标投影、完整格式、图片/图表/表格/删除依赖及全部 M9 验收继续。


### 2026-10-18 占位符继承几何补齐

对象模型现按 slide placeholder 的 idx 找 layout，再按已知类型找 master，暴露明确的坐标来源；仅当继承链和完整变换可判定时返回 box。普通无旋转/翻转的继承位置可局部覆盖，主版/布局不修改；歧义、部分 xfrm、继承旋转/翻转及复杂组坐标仍是待适配项。依据 [Microsoft placeholder 继承说明](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/8b5c01b6-a623-4952-a8ab-e6a5177e47ec)与 [python-pptx 的布局/母版查找实现](https://github.com/scanny/python-pptx/blob/master/src/pptx/shapes/placeholder.py)，本项目独立实现局部 XML 补丁，未引入该 Python 运行时或复制其源码。

39 项相关模型/Worker/服务回归和类型检查通过；选定源模型＋真实原生排版测试 1 项通过、11 项未选定。对合成文件将继承坐标物化为局部属性，往返同一位置后，1000 px 页面投影像素哈希一致，共享 layout/master 等部件字节不变。这是该样本的投影一致性，不扩展为所有继承语义或真实 App 验收。[对象证据的后续增量](../验收/证据/m9-development-office-pptx-objects-20261018.json)保留独立源快照和原始投影；当前尚未为对象增量打新包。


## PPTX 对象输入、选择与组投影（2026-10-18 后续）

仍依据 R3.4-P1 P07/P11/P12/P14、R07.11/R07.16，已接入 source ID 选择、文本框/11 种形状插入、双击正文、位置/旋转/层级面板与键盘菜单。实际页面继续由固定原生引擎生成；操作框取真实点坐标，面板显示 px 并转换为 EMU，未解析的位置不造框。完整格式、拖动内容预览及其他对象尚未完成，不称 P07–P15 全部交付。

未提交输入由单 notes 改为按 slideId/elementId（缺失表示 notes）隔离的不可变条目。queued blur 只 flush 自己的目标；显式保存/离开视图会 flush 全部，mutation 只清对应的原条目，不清旧回执之后的新输入。所有待提交条目先持久化再验证。活跃正文编辑仅 500ms checkpoint，失焦或显式保存提交；Escape 取消当前尚未提交内容，不撤销之前显式保存的文本。组合输入期间不换页、清输入或改变结构。正文 textarea 与 PDF session 分离，重新排版不卸载它。

恢复信封 WYPPTX2 保存目标批次，继续读取 WYPPTX1 单备注；单目标上限 65536 UTF-16 单元，最多 128 目标，编码后目标 JSON 768 KiB，完整头小于 1 MiB；无效 XML 候选（包括未配对代理与控制符）仍可恢复。超预算明确失败，保留内存输入，不截断或把草稿当成可保存的 Office 文件。

组坐标依据 [Microsoft DrawingML Primer §5.7.4–5.7.6](https://download.microsoft.com/download/e/1/4/e14fb96f-83b8-4a2a-84db-7fa8acbe061a/Office%20Open%20XML%20Part%203%20-%20Primer.pdf)：中心经过祖先坐标变换，宽高独立缩放，避免把普通 affine shear 错套到旋转子对象。首版忽略父级反射导致 M9-DEV-020；原生实测证明奇数反射需反转子旋转方向，已修正。合成两层缩放/旋转/翻转矩形的独立原生栅格中心及边界与投影在 2 px 内一致（96 dpi）。这一结论只覆盖所列样本，完整组与继承矩阵仍待验。

代码、原生复验、恢复快照与包状态见[本批证据](../验收/证据/m9-development-office-pptx-input-ui-20261018.json)。当前没有本批真实 App 结果，不证明文字输入视觉样式或 Codex 细节已经一致。


### 2026-10-18 P11 文字格式正式增量

依据 R3.4-P1、P11/R07.11；`pptx-format.ts` 对普通 shape 的 run rPr、paragraph defRPr/endParaRPr 及 pPr 作精确补丁，不重建正文。保留字段、软换行、lang/baseline、链接、未知扩展及未编辑部件；对齐和列表写入 DrawingML，已有缩进保留。空段与显式 false/reset 已覆盖，重复动作字节幂等。字体面板仅修改 Latin 字体槽，保留 EA/CS 及主题回退；首版将 Arial 写入三槽导致中文方框，原生视觉失败及修复均留存。参考 [RunProperties](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.runproperties?view=openxml-3.0.1)、[AutoNumberedBullet](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.autonumberedbullet?view=openxml-3.0.1)；未引入额外第三方实现代码。

模型只暴露已解析的局部/正文默认样式与 mixed 标记；完整 theme/master/placeholder 继承仍待接入，不伪造统一值。原位 textarea 尚未重现全部混合 run 排版。输入 blur 提交期间保留格式控件点击，由队列等待前一输入；真正动作和保存仍禁重入。259 项回归与原生、包内验证分层记录，不替代 App。源快照、安装目录和失败记录见[文字格式证据](../验收/证据/m9-development-office-pptx-text-format-20261018.json)。


### 2026-10-18 P13 外观源补丁与透明度缺口

R3.4-P1 P13：`pptx-appearance.ts` 与共享 schema 接入普通 shape/picture/connector 的填充、边框与样式、阴影和 shape 预设；表格/图表/组分别待适配。填充颜色修改保留 alpha 变换；线条修改保留原宽度、端点、join/cap 与扩展；阴影仅移除 shadow 节点，保留 glow/blur/reflection/未知节点。相同动作无新历史，撤销恢复原部件字节。未解析 theme/placeholder 效果与 effectDag 阴影转换明确拒绝，整个候选不部分落盘。新增默认边框为 2px（19050 EMU）、阴影为向下 6px、blur 12px、黑色 20%；是否与参考引擎完全相同仍须实际 App 对照。

依据 [DrawingML Outline](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.outline?view=openxml-3.0.1)、[OuterShadow](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.outershadow?view=openxml-3.0.1)。原生 96dpi 独立采样确认填充 RGB [204,34,0]、916 个边框色像素；阴影区域 RGB [225,225,225]，关闭后为白色。保留完整 3 份输入/投影、源快照及脚本日志，均非 App 截图。

M9-DEV-023：研究候选使用 [effectDag](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.effectdag?view=openxml-3.0.1) 的 alphaModFix amt=50000，固定 LibreOffice 路线的实际中心像素仍为不透明原色。已只读查看 [引擎效果导入](https://raw.githubusercontent.com/LibreOffice/core/master/oox/source/drawingml/effectpropertiescontext.cxx) 作为排查线索，没有复制实现代码；当前 native 探针才是本机构建证据。此能力未进入生产 action，P13 仍未完成；继续寻找保持原对象可编辑性的源格式/投影路线，不将 fill-only alpha 冒充整体透明度。

[本批证据](../验收/证据/m9-development-office-pptx-appearance-20261018.json)：267 项代码回归、1 项原生真实排版/独立 XML/像素检查，包内与 App 单独记录。


### 2026-10-18 P15 对象删除与资源依赖

依据 R3.4-P1 P15/R07.11/R07.18。`pptx-delete-element.ts` 先精确移除目标对象/组及已识别的附属引用，再检查剩余 slide XML 的所有关系引用。仅移除不再被使用的 rId；从整个 package 根重新求可达性，清理由被删边到达且不再全局可达的旧依赖，保留同页/跨页共享资源与原有孤立部件。私有 chart→embedded workbook、关系文件及必要 Content Types 一起修改。普通图表 fixture 删除 3 个私有部件，未编辑部件哈希不变，undo 恢复全部原部件。

连接线只解除指向被删除形状的 [Start/End Connection](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.startconnection?view=openxml-3.0.1)，保留另一端及原几何。已识别 build-list 条目可随目标删除；[动画 ShapeTarget](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.shapetarget?view=openxml-3.0.1)、未知对象编号引用和未知私有关系目前完整拒绝，不提交半个候选。动画/未知族适配仍属保真矩阵缺项，不宣称全部 PPTX 均可删除。

界面复用既有对象菜单，增加 Delete/Backspace 与成功后页面焦点；输入框、IME、repeat/修饰键、只读状态不触发对象删除。统一 buffer 历史保留选择，未通过的操作保留对象及错误。276 项相关回归通过；包内与实际 App 分层继续。[源码、日志和边界](../验收/证据/m9-development-office-pptx-delete-object-20261018.json)。


### P10 表格模型与精确输入（2026-10-18）

依据 R3.4-P1 P10，`pptx-table.ts` 读取 DrawingML 网格、单元格、合并属性与 firstRow/firstCol，保留零高度为自动尺寸；`explicitGrid` 仅表示源文件尺寸显式，不能当作排版后的实际尺寸。3×2 插入沿用原型示例和文档默认 tableStyle；单格文字复用结构化 run 补丁，未编辑单元格、样式、关系与其他部件保持。覆盖格禁止直接编辑，当前带域/软换行的文字修改仍有明确兼容边界。

M9-DEV-024 的原生失败说明 graphicFrame 外框不能代替表格列宽/行高。根据 [Microsoft TableGrid](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.tablegrid?view=openxml-3.0.1) 和 [LibreOffice table import](https://raw.githubusercontent.com/LibreOffice/core/master/oox/source/drawingml/table/tableproperties.cxx) 核对格式，再以固定引擎复验。现在按原网格比例修改内部尺寸，累积整数 EMU 分配确保总量精确，保留 cell/body/样式；零/自动尺寸缺测量时拒绝高度修改而不部分写入。链接是格式/实现参考，当前上游源码不作为固定版本实测替代，未复制上游实现。

输入增加 `(slideId,elementId,row,column)` 身份，与备注和普通正文互不覆盖；WYPPTX3 新写、WYPPTX1/2 严格兼容读取。仍保留原始组合输入，包括尚不合法的 XML 字符；真正提交时再校验。Renderer buffer 保留目标单元格、序列化失焦、checkpoint 先于 mutation、组合保护与取消；表格 UI 尚未接入。

验证：287 项相关回归、类型检查通过；真实 Worker/native 1 项通过，15 项未选定。保存后独立 ZIP/XML 检查只改变 slide1、网格为 350×130pt；新/旧表格文字、中文、重开、3 个独立草稿目标恢复、5 次撤销后所有原部件一致。参见[表格证据](../验收/证据/m9-development-office-pptx-table-20261018.json)。本增量未打包，真实 App 未验收。

布局研究尚未接产品：FODP 只给实际表格外框，自动 row-height 仍为 0，不能直接等分；固定引擎 Python/UNO wrapper 两次退出 137，无测量结论，未改签名或系统保护。`实验/pptx-table-svg-probe.py` 在合成私有副本中仅覆盖 cell fill 为独立标记，再读取原生 SVG 的 cell polygon；本样本 12 格完整命中，SVG 文字位置逐项一致，源件不变。SVG 不在 UI 执行；后续需明确解析预算、严格禁止外部实体、保持现有 Seatbelt/宏禁用/进程预算并覆盖空格、合并、隐藏页和组/旋转。当前不能把这一实验当成正式定位能力。独立 FODP 探针曾生成 6 个缓存并改写 26 个供应商 Python 缓存，生产资源/签名校验已拦住；已从固定官方 DMG 重建构建资源，r5/r6 通过原有校验，正式 native 隔离和已打包应用未改。


### 2026-10-18 P10 实际格子定位、选区与输入

依据 R3.4-P1 P10/W15/W16/W26/W28/Y13。`pptx-table-layout.ts` 在一次性 PPTX 副本中给合并锚格写唯一 RGB 填充；固定 LibreOffice `impress_svg_Export` 经已有原生沙箱输出，由文档 Worker 严格读取 cell 四边形。只接受既定 SVG 根/尺寸、TableShape 内唯一标记、闭合平行四边形与坐标预算；对未适配 transform/缺失/重复标记明确拒绝。仅剥离引擎固定的惰性外部 DOCTYPE 声明，其余 DTD/实体仍拒绝；SVG 从不执行或进入 renderer DOM。最多 65,536 标记、2 MiB 定位元数据，沿用现有 XML 节点/深度/部件预算、40 MiB 引擎输出、1 GiB RSS 和单个原生进程 20 秒限制。PDF 与 SVG 是两个隔离投影，不能将单进程 20 秒描述为两次投影总耗时。

真实实验发现 SVG 全页导出跳过隐藏页（17 格只找到 11 格）；仅在临时副本显示隐藏页后 17 格全部返回，源隐藏属性与全部源部件不变。空格、纵向合并锚格与长文字撑高的边界来自真实引擎，不等分 graphicFrame。原始/标记 SVG 的文字位置一致。[完整证据与失败样本](../验收/证据/m9-development-office-pptx-table-ui-20261018.json)；不能据该样本外推全部组/反射/旋转导出矩阵通过。

PptxDocument 保存临时版本缓存，在 edit/history 后失效，不进入历史或磁盘。FilePptxService 先做 PDF，再取同版本定位候选、原生 SVG、Worker 数值结果；每步核对所有者/版本/取消。仅 UNSUPPORTED 转为显式定位提示并保留 PDF，其余错误仍失败。用户编辑不会排在慢原生排版之后；旧预览不会发布。

`pptx-table-object.tsx` 按实测四边形投影 CSS 单元格，支持合并锚格导航、范围清除和分级 Escape；未选中表格也有可聚焦入口。刷新期间仅保留原输入节点和已有位置，旧格子不可交互；输入和备注按独立目标恢复。范围清除作为一次源 XML 候选/历史动作，保留格式/样式；任何不支持的正文使整次拒绝。M9-DEV-025 修复富文本 helper 忽略域文字而把清空误当 no-op 的问题，候选后再验证全部目标为空。自动行高的高度修改仍明确拒绝，测量高度尚未转换为源行高编辑规则。


### 2026-10-18 P10 自动行高调整与取消修复

自动行高现可使用同版本 Worker 已验证的实际格子边界写回行高比例，整型 EMU 合计保持目标尺寸；只接受边界完整一致、无组/旋转/反射的已知坐标关系，不凭合并总高度猜内部行界。格式面板显示实测高度，未定位时禁用对应高度控件。原生服务链实测目标 100pt、源合计 100pt、重新排版约 99.92pt（固定引擎舍入），单元格正文和无关部件保持不变，撤销恢复全部源部件。复杂变换/歧义合并和文字最小高度仍待覆盖。

M9-DEV-026 在继续检查时发现并复现：取消表格定位的 Worker 请求会关闭持有未保存模型的 Worker，导致后续编辑/保存失败。准备定位副本和解码 SVG 两个时间点均有失败证据。修复区分投影与文档寿命，队列/原生仍可取消，已开始的 Worker 操作沿用文档寿命和 15 秒上限，结束后丢弃被取消投影；两种情况都能继续编辑并保存。旧 table-ui-r2 包尚不含此修复，不作为后续交付候选。

[本轮证据](../验收/证据/m9-development-office-pptx-table-measured-20261018.json)：311 项 Office/共享回归通过、50 项 opt-in 未执行；取消修复后 35 项受影响测试及类型检查通过。1 项原生自动行高/保存/独立回读/撤销验证通过，17 项原生未选定。`pptx-table-measured-r1` 已构建并通过本机原生检查，包内选定表格验证 1 通过/6 未选定，含自动行高、保存/独立回读、清除撤销、12 格定位、重开、3 个输入目标恢复及原部件完整恢复。实际 App 仍被工具锁屏阻塞；正式 3/419 不变，未发布。

实现入口 `pptx-table-measurement.ts`、`PptxDocument.tableProjection.layout`、`resizePptxTable`。测量版本与源候选一致才可使用；编辑和撤销清除缓存。测量不进入保存动作协议，仅作为 Worker 内部 resize 参数。取消修复不改变 OfficeWorkerClient 的关闭/超时逻辑，避免为视图取消放松文档 Worker 故障清理。


## 2026-10-18 P08 本机图片接入（实施中）

依据 R3.4-P1、R06.10/R07.11/R07.16/R07.18 及既有 P08 动作矩阵，接入插入和替换图片；对应正式 W16/W26/Y10/Y13，完整正式用例保持待执行。原型已有图片入口和替换合成图状态，本批以真实系统文件选择器读取所选文件字节，不接受路径/URL。先接 PNG/JPEG，最多 20 MiB、8192 单边、1600 万像素；动画、多图和非默认 EXIF 方向暂明确拒绝，保留原图，不据此缩减原验收范围。

复用 native broker 的 ImageIO 解码，在有界子进程检查 MIME、完整性、帧数与尺寸；主进程建立内容哈希回执，Worker 仅接受匹配字节的内部回执。写入原图字节，不将缩略图或 PDF 用于保存。新图片居中并保留宽高比；替换仅改目标 blip 的 embed 关系，保留裁剪、变换、其他效果和所有旧 media/关系，因此共用图片不被修改。扩展替代图像和外链替换目前显式拒绝，后续仍需适配。选择器生命周期和文档版本隔离，读图失败/取消不改变文档。

本批预定验证：源包逐部件哈希、共享 rId/跨页引用、裁剪/变换保留、同图替换 no-op、撤销/重做、错误回执与损坏/超限/多帧图片；组件覆盖只读/IME、取消和迟到输入；真实服务链用原生解码/Worker/保存、独立 ZIP/XML 读取和 PDF 像素复核，再打包复验。当前尚未填通过，App 实际操作仍依赖 CUA 可用。

参考：[Microsoft Picture 定义](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.picture?view=openxml-3.0.1)、[Apple ImageIO 完整状态](https://developer.apple.com/documentation/imageio/cgimagesourcestatus)、[图像帧数](https://developer.apple.com/documentation/imageio/cgimagesourcegetcount(_:))；实际行为以本机固定引擎验证为准。没有复制第三方实现。


P08 当前验证补充：原生 ImageIO 的 Complete 状态不保证截断 PNG 严格完整，真实失败编号 M9-DEV-027。现于保留文档的有界 Worker 内验证 PNG 块 CRC/顺序/IEND、解压长度/消费长度/扫描行，以及 JPEG 的完整 marker/scan/EOI；验证失败发生在补丁前。327 项相关回归与类型检查通过，原生选定 1 项通过，覆盖跨页共享图片独立替换、原始字节保留、PNG/JPEG 三页颜色、保存/重开及撤销恢复。包已构建；真实界面继续。[准确轮次、失败与哈希](../验收/证据/m9-development-office-pptx-image-20261018.json)。


### 2026-10-18 P09 图表数据的首批正式接入

沿用 R3.4-P1/P09 与已确认的“图表数据”原型输入，本批接入单系列、1–8 个连续非负数值的同长度编辑。数据来自真实 chart cache；提交前在 Worker 中读取内嵌 XLSX，核对引用、缓存与源格数值一致。修改只写对应数值格与缓存；目标图表和内嵌工作簿先复制到新部件，再只重定向所选对象，原共享 chart/rId 使用者及未知部件保留。外部数据不抓取；多系列、稀疏缓存、公式依赖、数量变化、扩展/透视结构当前拒绝并保留原件，仍是后续本期适配事项，不从 P09 范围删除。

界面复用既有格式面板“图表数据”输入；原始未完成文本按 slide/element/chart-values 独立保存，先 checkpoint 再校验或修改。错误时保留输入，修正后可重试；组合输入不提交，Escape 只取消当前输入。草稿封装升为 WYPPTX4，读取保留 WYPPTX1/2/3 原语义；旧封装不接受新图表目标。选中图表不会生成对象文本 textarea；恢复图表原始输入时打开格式面板。

32 项首批模型/服务测试通过；47 项后续输入/草稿/组件测试通过，轮次有重叠。Office/共享回归 337 项通过、52 项 opt-in 未执行，类型检查通过。原生首轮 1 通过/19 未选定：缓存与内嵌 B2/B3 从 9/4 改为 15/6；独立 ZIP/XML 相符，固定排版柱高 157/63 px，比例约 2.49；保存重开与撤销恢复原部件通过。V4 原生草稿恢复复验 r2 已通过（1 通过/19 未选定），完整 preview 的组合焦点/取消回归 16 项通过。新增/类型切换、坐标轴/网格线/图例、完整九类型、共享数据与恢复矩阵继续；当前运行图片包不含本批，真实界面尚未验。

规范参考：[Microsoft 图表外部/内嵌数据](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.charts.externaldata?view=openxml-3.0.1)、[ChartEx 数据模型](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/8a963284-245d-4c2a-935d-cc6aef448b09)、[ChartEx 类型](https://learn.microsoft.com/da-dk/openspecs/office_standards/ms-odrawxml/2ea3f228-fe39-4f55-b8ec-cee89596e926)。后四种现代图表不能仅换旧柱图标签或图片冒充；仍需专门来源/原生验证。


P09 本批 `pptx-chart-data-r1` 已构建并通过本机全部包内原生检查，尚未启动。[构建、源码及准确验证记录](../验收/证据/m9-development-office-pptx-chart-data-20261018.json)。运行中的图片包仍等待文件选择器人工确认，两个包不同时共用 userdata。


### 2026-10-18 P09 坐标轴、网格线和图例

已有基础图表的三个开关已接源 XML 与界面，验证轴身份/交叉引用，只复制目标图表并保留内嵌工作簿和其他共享使用者。340 项 Office/共享回归通过、53 项 opt-in 未执行，类型检查通过；原生选定 2 通过/19 未选定，覆盖既有数值/草稿恢复回归，以及开关保存、独立 XML/原数据核对、真实渲染、重开和完整撤销。已查看开启/关闭渲染图，尚未执行 App 界面。未单独打包，随后续图表包复验；插入、类型切换和完整矩阵继续，正式 3/419 不变。[本批证据](../验收/证据/m9-development-office-pptx-chart-options-20261018.json)。

参考 [CategoryAxis](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.charts.categoryaxis?view=openxml-3.0.1)、[Legend](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.charts.legend?view=openxml-3.0.1)。网格/图例关闭会移除该显式装饰节点，再打开使用默认装饰；撤销完整保留原样式，不把重新创建默认样式描述为还原自定义样式。


### 2026-10-18 P09 五种基础图表插入/切换与原生显示缺陷

依据 R3.4-P1/P09，新增真实基础图表及独立内嵌 XLSX；默认 3/5/2 与数字横坐标 1/2/3 对应原型数据。柱/折线/饼/面积/散点使用实际 chart 类型，切换保留数据引用及工作簿，目标写时复制。文字分类不能静默转为散点的数字序号；有未适配的类型专属、标记或系列外观时保留源件并拒绝。局部命名空间绑定随转换保留，饼图往返新增的轴不依赖失效的前兄弟作用域。未知保真矩阵继续，本次不是支持所有既有图表的结论。

M9-DEV-028：首次原生流水线数据/保存断言通过，但实际渲染显示折线和散点成为平滑连线，视觉复核未通过。原失败留在 `/private/tmp/willyou-m9-pptx-chart-basic-native-r1-evidence`；散点标记之间有 390 个连线像素，折线中点偏离直线 13.75 px。现在显式设置非平滑、线的可见性和标记；r2 真实图像已是直线与独立点，但旧精确色阈值漏掉浅蓝主题标记，测试失败保留。r3 改用蓝色范围识别，同时保留“散点间 0 像素”和“直线偏差 <3px”断言，正在复验。未降低几何标准或把模型数值一致当作显示通过。

参考 [LineChart](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.charts.linechart?view=openxml-3.0.1)、[ScatterChart](https://learn.microsoft.com/fr-fr/dotnet/api/documentformat.openxml.drawing.charts.scatterchart?view=openxml-3.0.1)、[AreaChart](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.charts.areachart?view=openxml-3.0.1)。四种现代图表仍需 ChartEx 来源/数据/原生适配；规范中的 [CT_Series](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/86df19ea-8e94-49fc-9160-377c1b40b985) 和 [CT_ChartSpace](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/416e664f-c6f6-4ed9-914b-4eaaa20724dd) 只说明格式，尚无本机现代图表通过结论。

P09 r3 原生复验已通过：折线偏差 0.5px、散点间 0 连线像素；五类保存/数据/重开与 12 步撤销通过。构建中，[准确证据](../验收/证据/m9-development-office-pptx-chart-basic-20261018.json)。

`pptx-chart-basic-r1` 最终构建通过，ASAR `6742a29200ac9ffa25739ed0c9d57e2c5d3a3c48bffb09e987995bfa9b92517a`；包内图表专项 1 通过/7 未选定。未启动新 App，既有图片窗口待解锁后续验，正式 3/419 不变。


### 2026-10-18 P09 ChartEx 实测失败与错误预览拦截

M9-DEV-029：固定引擎的 ChartEx 导入存在类型/数据解析，但绘制器缺失时回退为折线；四类合成图表和官方原样漏斗图均实际复现。详见[精确版本源码、样本与图像](实验/pptx-chartex-引擎实测.md)。新增 Worker 来源能力信息及两个预览入口的拦截，原图表/内嵌数据和其他编辑继续保留；孤立定义不阻止预览，未知类型标识不进入提示文案。357 项分层代码回归及类型检查通过，55 项 opt-in 当时未执行。新包及包内结果见[机器证据](../验收/证据/m9-development-office-pptx-chartex-20261018.json)。这只是停止错误预览，四种现代图表真实渲染/编辑尚未完成；后续研究受控数据矢量投影，保存仍保留真实 ChartEx。


2026-10-18 本批收口：`chartex-guard-r1` 构建和全部本机包内原生检查通过，ASAR `97b7254f53f3808cd16678cecd981e46d279bdfb105e46a49f037ae3f9da3de6`；包内专项 2 通过/7 未选定，验证四种错误预览拒绝后的原数据保留、备注保存/重开及基础图表回归。真实 App 未启动新包，现代图表实现仍开放，正式 3/419 不变；详细状态以 ChartEx 机器证据为准。


### 2026-10-18 ChartEx 真实数据接入

`pptx-chartex-data.ts` 按真实系列 dataId、numDim/lvl/pt 和本机内嵌来源解析四类现代图表；PPTX 对象模型识别为 chart。数值编辑复用既有工作簿/缓存一致性检查及写时复制，仅重定向所选对象；同长度 1–8 个有限非负值之外的数量/依赖仍未适配，拒绝时保留源件。类型切换和显示开关尚未接入，不提供这些未实现控件。

[隔离矢量实验](实验/pptx-chartex-引擎实测.md)已证明四类数据几何可用，尚未进入 Worker 预览管线；下一步补真实样式/标题/坐标轴/图例及单独 previewSource，确保临时投影不进入 materialize、草稿或历史。原生错误预览拦截仍有效。276+95 项代码回归和类型检查通过，最新打包/原生证据见[批次记录](../验收/证据/m9-development-office-pptx-chartex-data-20261018.json)，不作完整 P09 或 App UI 通过结论。


本批收口：`chartex-data-r1` 本机包构建与全部包内原生检查通过，ASAR `0f0ee0e05bf927278ba22f899c9113dbc751803ffbf7b04179de719a6fa3e853`；包内选定 3 通过/7 未选定，含四类真实改值、独立源 XML/内嵌表回读、保存重开、未完成输入恢复、撤销恢复全部原部件及基础图表回归。609 文件构建基线与当前源码一致。未启动新 App，现代预览仍未接入，正式 3/419 不变。

### 2026-10-18 P09 受限 ChartEx 源件预览

四类现代图表已接入真实插入、基础转现代/现代间转换、明确样式下的轴/网格/图例，以及单独的 `previewSource`。编辑和只读预览均核对内嵌数据后生成临时 DrawingML 布局，源 ChartEx、工作簿、草稿及撤销链不使用投影。取消预览仍可继续编辑/保存，旧版本被拒；表格定位使用相同源件隔离。技术边界与独立比例/开关/保存恢复结果见[实测增量](实验/pptx-chartex-引擎实测.md#2026-10-18-接续受限源件预览正式接入)和[本批证据](../验收/证据/m9-development-office-pptx-chartex-preview-20261018.json)。

现代转基础、复杂来源格式、数量变化、完整组变换及实际 App 矩阵尚未完成；原型树图间隔差异单列，不宣称精确视觉对齐。M9-DEV-029 继续开放，正式 3/419 不变。

### 2026-10-18 P09 九类型源格式双向转换

新增 `pptx-chart-convert.ts` 和共享 `pptx-chart-workbook.ts`，在实际 Worker 的异步 chart-type 路由验证内嵌数值/分类，构造目标源图表并调整选中对象的关系族、内容类型和 graphicData 命名空间；保存仍使用真实图表及 XLSX。仅复制目标依赖，未选共享使用者保持原部件。`chartProperty` 保留 DrawingML 子树和局部 namespace，兼容 Strict/Transitional；指纹按 URI/本地名比较，不依赖前缀。

现代→基础保留明确逐点颜色、字体、实际公式/缓存、底部图例开关及兼容轴/网格；散点的 x 必须来自内嵌数值格。基础→现代继续拒绝未映射的布局、横轴网格和自定义轴位置，避免静默丢失。分箱/汇总改变点数、数量变化、多系列、复杂来源样式和完整图例语义仍待实现；饼图经过无轴格式后不能声称恢复此前轴配置。17 项模型测试、真实 Worker、原生九类型44步撤销及包内结果见[本批证据](../验收/证据/m9-development-office-pptx-chart-roundtrip-20261018.json)。

M9-DEV-030 的固定引擎导入器只在 marker symbol/size 改变时处理逐点颜色；显式每点 circle/6、系列默认 none 后，真实渲染三色像素由0/0/0变为66/66/68。该处理也改变系列图例标记，完整外观和 App 尚待验证。没有把 LO 源码复制进入产品；来源、版本及失败记录见[实测补充](实验/pptx-chartex-引擎实测.md)。M9-DEV-029 仍开放，正式3/419不变。

### 2026-10-18 P09 数量变化及单点缺陷

已知单系列九类型的 1–8 项数量变化现已接入 `pptx-chart-resize.ts`，通过新数据工作表和目标图表写时复制保留原工作表及相邻数据；更新真实公式、缓存、分类和逐点样式。71 项最终受影响代码检查、真实 Worker／原生 2 项选定回归通过。工作簿保护／签名、公式依赖、数据验证和复杂来源的数量调整仍待适配，保留原件不能替代完成这些功能。

M9-DEV-031 暴露单点折线／面积图无可见数据点。折线已修复并原生复验，面积标记仅有隔离组合系列实验，生产解析、编辑、恢复及 App 待接续。完整实现与证据边界见[数量与单点研究](实验/pptx-chart-resize-单点与数量.md)和[本批证据](../验收/证据/m9-development-office-pptx-chart-resize-20261018.json)。


## 2026-10-18 DEV053 共享字符串按引用数修复

对应 R07.18 / Y11，纠正前述“共享字符串转inline且只更新引用数”的实现：先遍历所有实际工作表统计目标索引引用；唯一引用原位更新，共享引用追加新si并仅改目标格索引。编辑区间按解码后的UTF-16文本确定，保留原有富文本run及粗体/斜体属性，重新编码ST_Xstring；注音或未知对象明确拒绝。count/uniqueCount保持有效，无关部件逐字节保留，公式缓存沿现有声明失效。

51项受影响回归、2项实际Worker/草稿/原生保存/重开通过；[原失败、源码与磁盘哈希](../验收/证据/m9-dev053-shared-strings-20261018.json)。Y11模糊匹配负对照尚未全部执行，不计正式通过；r7不包含本修复。


### DEV053 最终复验与 Y11 匹配唯一性映射

共享字符串原位更新还影响复选框关联检查：cell索引不变不代表语义值不变。现在共享字符串部件变化时解析前后字符串，并覆盖未改sheet的关联格比较；未知命名绑定保护负对照通过。Y11按实际生产结构化目标验证唯一性：严格动作契约拒绝无身份/附加文本搜索，解析器拒绝重复对象编号；不为验收引入未使用的模糊补丁API。重复正文、跨run、跨sheet共享引用、原生保存/重开及朴素替换负对照完整结果见[最终验收](../验收/证据/m9-acceptance-y11-20261018.json)。原R07.18及用例步骤/预期保持不变。


### DEV054 保存回执重放与 J07 版本化物化

同一保存编号在首次成功后再次到达时，不能以更新后的baseHash重建旧草稿。XLSX/PPTX共享有界回执元数据缓存（128项/活动文档，关闭释放）；只缓存回执/草稿标识，不缓存文档模型或源字节。回放返回当前Worker状态，旧回执不得清除新dirty，也不再写入外改的源件；改变version/draftId/bufferVersion复用opId明确拒绝。超过短期缓存的请求仍由Worker版本和原生日志保护，不能把本内存缓存当持久化日志。

J07按已批准R07.12的不同实现选项映射：本机owner+文档ID+expected version取代CRDT origin/update，真实500ms物化草稿与显式public保存各自验证；[测试、失败与完整映射](../验收/证据/m9-acceptance-j07-dev054-20261018.json)。J08全部失败/重试边界仍待验。


### DEV055 XLSX 保存失败暂停

复用PPTX的automatic/explicit保存区分，阻断cached计算持续增加bufferVersion导致的自动循环。失败回执或异常暂停自动源写，新的编辑仍可checkpoint并保留错误；显式保存解除暂停，干净reload重置。工作表/范围操作不隐去暂停原因。本修复不改变成功路径3秒自动保存或500ms草稿边界；J08允许1000ms重试的完整矩阵仍未收口。[真实权限失败与恢复证据](../验收/证据/m9-dev055-office-retry-loop-20261018.json)。


### DEV056 / J08 有界草稿重试与故障映射

沿R07.12允许的版本化OOXML方案，append映射为expected-version edit，materialize为真实Worker快照，订阅映射为目录watch及快照补扫。OfficeBuffer的checkpoint只对带IO代码的恢复写入异常安排一次1000ms重试；同draft/version重放幂等，包括写入完成但回执丢失。新输入重新安排500ms checkpoint，显式save/discard/close撤销旧定时器；CHANGED/TOO_LARGE/CONFLICT/UNTRUSTED/TIMEOUT、未知异常和源文件写回都不进入该重试。DEV055失败停止源写语义保留。无需变更已确认页面/错误条；用户错误仍由workspace-panel统一显示。

[故障矩阵、红测及包内复验](../验收/证据/m9-acceptance-j08-dev056-r9-20261018.json)按注入点与真实操作区分；正常macOS订阅断开后实际文件变更可补扫，模型/草稿保留，旧根禁止源写。J08原U/I完成，不替代其他用例的P/A。
