# DEV151 XLSX公式缓存与独立读取器

依据R3.4/R3.4-P1、M9-T-Y12原I/A范围及R06 Office保存规则。既有开发/测试授权，feature/0.0.1、HEAD 89de9af加工作区增量。Y12现完整通过，正式260/419（62.05%）；阶段未完成、未发布。

## 实测行为

新原生I2使用当前FileService、原r89 broker、ASAR真实文档Worker和POI/JRE。自建XLSX的输入A1=8，依赖B1=A1*2/C1=B1+3缓存16/19；另真正不支持函数WILLYOUNOTIMPLEMENTED(A1)控制为999/1002。均编辑A1=21。直接service save未主动重算时，两个公式旧缓存清为空、fullCalcOnLoad/forceFullCalc=1，fresh open由原生POI得到42/45或实际NotImplemented失败后的空缓存/明确未刷新提示。读取不改源文件。

真实App浅深×支持/不支持共4组，实际单元格/公式栏键盘、保存/关闭/重开。UI保存会先尝试重算：支持式写新数值缓存42.0/45.0并显示42/45；不支持式仍可保存编辑，旧999/1002不再显示、cache-only读取为None、界面有原有未刷新说明。D1=107/A3原文/D3=0的cell XML、未知部件及其它ZIP部件SHA全部不变，条目名称/顺序不变；原公式正文逐字保留，未把计算器重写包当原文件。

独立打包LibreOffice以4个独立UserInstallation/输出目录headless重算副本，正常42/45，不支持函数产生#NAME?；不是旧缓存或假成功。**该读取器副本会规范化函数名大小写及重写包，不能作为原文件保真证明**。原源SHA保持。固定openpyxl3.1.5的data_only和formula模式真实读取4源+4LO副本共8项，数值/空缓存/错误均符合预期，8文件SHA/inode/mtime/ctime保持。原件保存的函数名仍精确，副本比较单独记录大小写归一。

当前15代码=2新native I+13既有cell-edit/calculation回归，全过零skip/fail；类型检查通过。历史代码并集2253是累计证据边界，非本轮全套。App实际缺默认Calibri时已有兼容列宽说明，本轮不算字体或Codex完整V通过；不支持函数提示仍含引擎诊断，不声称提示视觉一致。

## 失败与边界

首A原选区未确认，输入21追加为821并被自动保存/正确重算1642/1645。保留失败、driver和该私有文件，不归因为已证产品缺陷；改为等待公式原值/焦点，发送可信native selectAll并观察selectionStart/End后再输入。未证明工具与异步焦点哪方导致首轮行为，也不据此宣称物理输入法验收。第二A和首I对合法42.0作字符串42比较过严；改数值类型/值语义，空缓存仍严格None。首I14绿1红保留，最终15全绿。首次独立reader在LO小写函数名处失败，源仍原文，改副本语义比较后8绿。最初Python fixture语法错误未执行生成，修复后才有样本；stderr仅tool观察，未伪造历史日志。

没有生产/P/native/config/deps/版本变化，也没有新构建。复用r89，82运行文件新核对；原DEV150报告和107项artifact全部重新核验，原六native smoke沿用。3自有App均已退出，最终A正常0/null，2失败壳由harness清理；4headless soffice PID已退出、转换命令均0并有实际读取产物。5原RPC handler恢复、原样结果hash一致，无renderer未捕获异常。soffice的task-policy stderr保留，不误写成功能失败或平台全验。

## 复现与恢复

- `python3 scripts/files/formula-cache-fixtures.py`只创建自有/tmp真实ZIP；给`formula-cache-ui.mjs`设置WILLYOU_FILES_APP及WILLYOU_FORMULA_PROJECT，实际App流程及4独立LO副本自动执行。
- I设SMARTDD_FORMULA_PROJECT为**另外一份未改原fixture**，SMARTDD_FORMULA_APP为r89包，再经scripts/run-tests.mjs选择formula-cache-acceptance.test.ts、cell-edit.test.ts、calculation.test.ts。
- 外部缓存读取器：仅临时测试目录安装openpyxl3.1.5、et-xmlfile2.0.0，不进入产品依赖；`verify-formula-cache-readers.py <A结果JSON> <临时依赖目录>`运行真正data_only/formula读取。版本、196源hash及metadata/RECORD归档；没有系统或项目Python安装改动。
- `verify-formula-cache.py`为独立标准库缓存XML读取器，不做公式计算；完整原/保存/LO三组12工作簿压缩归档，便于另一读取器复核。

恢复基线1306输入=DEV150父1301全同+5新验证文件，源manifest与5文件delta同归档；产品ASAR/native及原配置不变。r89 ASAR `f49efd43440d0124f9758ab11902b65f39b2a5cf5f04750adb89030acbc5bf4b`。[54项证据](../验收/证据/m9-acceptance-formula-cache-dev151-r89-20261019.json) SHA256 `82c0eaf8119fdf1693ad0a8fc9dd2a1b571c040f54e603be3efcadbe4008f360`。

K03/K06/K07/Y10不借本批通过。初始大小边界核对发现K06 review、K07附件/custom loadText有真实入口缺项，保留原用例/分母；不以I探针替代A或恢复已排除chat。Y10原DOCX/XLSX/PPTX全格式保真/LibreOffice渲染另验。其余157未执行+2阻塞，156含A；系统/人工/参考/平台及DEV139-OBS01/DEV111保留，继续独立测试。
