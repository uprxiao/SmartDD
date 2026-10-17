# M9 开发前 04：Office 编辑保真与计算路线

更新：2026-10-17。依据 [R3.4 需求](../需求.md) R06.8、R06.10、R07.11–18，以及[开发前工作划分](../开发前与开发中工作划分.md)。本轮只做隔离技研与资料收口，不接入生产编辑器、不修改正式验收结果、不改旧失败证据。

**前期结论：已找到并验证可实施的替代路线，原先阻塞删除工作表的样本已通过。** XLSX 采用“原 OOXML 包＋精确依赖适配＋Apache POI 5.5.1 独立计算＋只提取计算字段”；LibreOffice 继续承担已验证的文档／演示稿候选与排版任务。不能把 LibreOffice 整份重写的文件当作原件保存，也不能继续让它计算含错误引用的 XLSX。新增 Java 运行时由[09 资源方案](开发前_09_引擎资源.md)统一确定分发基线；本机 Oracle Java 不作为产品捆绑来源。

本结论是**04 的开发前技术路线和代表机制已收口**，不是全部 Office 动作已实现、任意 Excel/PPT 文件兼容或 M9 已验收。正式实施仍按原动作矩阵逐项实现与验证，不以能力门禁永久删掉已确认功能。

## 1. 目标与实际结果

| 目标 | 本轮结果 | 证据 |
| --- | --- | --- |
| 原 OA12 失败样本得到正确独立重算 | 复用原 `office-actions-probe.py` 的同一 fixture 与删除函数；未改原公式和期望。POI 重算、写隔离候选、重新打开均得到 `#REF! / #REF! / 100` | [OP03 原始结果](../验收/证据/predev-office/final/result.json)、[实际删除文件](../验收/证据/predev-office/final/oa12-deleted.xlsx) |
| 关键公式依赖有真实文件证据 | 15 个公式结果格，覆盖直接／范围／命名／表引用／3D／共享／数组，以及 IF、IFERROR、INDIRECT；改名与删除均独立计算、提取缓存回原包、重新打开；另用 openpyxl 读取全部缓存，数组从属格也核对 | OP04–06，见上述结果；[删除后的原包候选](../验收/证据/predev-office/final/rich-delete-final.xlsx) |
| 避免只适配单一值和英文名称 | 8 组名称／数值变体 × 改名、删除 2 种动作，16/16 通过；含中文、空格、多个撇号、emoji、希腊文、负数、零、小数与较大数 | [变体结果](../验收/证据/predev-office/final/variations/result.json) |
| XLSX 样式、数字、表与未知内容保留 | 共享 font/xf 写时复制；只改目标格颜色，邻格样式不变，数值与 number format 不变；合并范围内原值仍保留在包中；未编辑 table、chart、theme 和未知部件哈希保留 | [OP01 结构结果](../验收/证据/predev-office/final/preparation.json) |
| PPTX 表格、图表、内嵌表、主版与关系 | 目标表格文字改变；图表 cache 和内嵌工作簿的同一值同步为 9；未编辑主版、layout、theme、另一页不变。复制页时复制可变 chart/workbook 与 notes，新页改 15 不污染原页；删复制页只释放其私有依赖 | OP02、OP07、OP09、OP10；[编辑文件](../验收/证据/predev-office/final/rich-edited.pptx)、[复制文件](../验收/证据/predev-office/final/rich-cloned.pptx) |
| 真正 XLSX 复选框存储路线 | 生成真实表单 checkbox；重开仍是控件、状态 1、绑定 B2=TRUE。精确改 3 个部件取消勾选，再重开状态 0、B2=FALSE，其余 11 个部件哈希全同 | [checkbox 结果](../验收/证据/predev-office/checkbox/checkbox-result.json)、[精确修改文件](../验收/证据/predev-office/checkbox/checkbox-precise-unchecked.xlsx) |
| 真实排版程序接受候选 | LibreOffice 打开／导出 3 份 PPTX（编辑、复制、删除复制页）及改名 XLSX 均通过；表格文字、图表和继承模板实际渲染可见 | [渲染结果](../验收/证据/predev-office/final/render-result.json)、[实际 PDF 第一页](../验收/证据/predev-office/final/render-rich-edited/page1.png) |

计数分别为：**2/2 包结构检查、8/8 计算与关系检查、16/16 名称／数值变体操作、1/1 复选框闭环**。其中 OP08 是正确拒绝非预期丢件，不算新增格式支持。真实 LibreOffice 渲染为 **4 项通过、1 项已知限制复现**；不把后者算通过。以上均不计入 M9 的正式 App 用例通过数。

## 2. 原失败为什么关闭，哪些错误仍保留

### 2.1 原 OA12 的替代路线

原 [R3.4 失败记录](实验/r34-office-actions-矩阵与验证.md)保持不变。当前 LibreOffice 26.2.4.2 读取包含 `#REF!` 的标准 OOXML 公式时会将其误识别为名称。它自己删除工作表、导出、重开也复现；本轮把最终精确修改文件再次交给它导出 PDF，仍有 `#NAME?`。**没有宣称修好了 LibreOffice 本体。**

POI 5.5.1 在原删除结果上直接计算，正确识别错误 token；重新生成的临时文件再次重开后也正确。产品路线改为 POI 计算 XLSX，且前端使用这一路结果显示表格和公式。含这类公式的工作簿不能再交给该版本 LibreOffice 计算后用于产品预览、缓存或覆盖原件。用户在外部 LibreOffice 打开同一文件仍可能遇到该软件自身的错误；Microsoft Excel、Numbers 与其他版本的真实重开兼容验收仍在开发／交付阶段执行。

### 2.2 POI 也不能直接当完整编辑器

本轮保留了两个真实负对照：

- 直接调用 `removeSheetAt` 后，依赖公式仍引用已删工作表，计算出现 `Invalid sheetIndex: -1`。所以**删 sheet 不委托给该 API 独自完成**；先按包内真实依赖生成精确候选，再计算。
- 原始共享公式 `Data!B2*2`／`Data!B3*2` 在本样本中被 POI 共享公式展开路径读成 `B2*2`／`B3*2`，结果为 14／14，正确值应为 6／8。适配层先依据 shared master、相对位移及绝对地址展开成显式公式，再交给 POI；通过后再进入候选流程。原失败 stdout 保存在[历史证据目录](../验收/证据/predev-office/history/)。

另外，POI 的原生改名会把本样本 `SUM(Sales[Value])` 展开为具体地址。虽然当时数值相同，后续表扩展语义会不同，因此生产路线不复制该公式结果；精确适配保留原结构化公式，只提取经计算的 `t/v`。不能因当前数值相同就认定公式等价。

这三类已知缺陷均有明确处理路径和通过样本；不是靠改变断言、写死错误缓存或关闭功能处理。

## 3. 已证范围与明确未证条件

| 机制 | 已证、可据此实施的范围 | 尚不能宣称支持完毕 |
| --- | --- | --- |
| 普通公式 | 本工作簿 A1 单格／矩形范围、绝对与混合地址；字符串中的 `Data!B2` 保留原文；数值计算、SUM、IF、IFERROR | 全部 Excel 函数、循环计算、迭代配置、所有 locale／日期／误差语义 |
| 命名与结构化引用 | 全局直接命名范围；`Sales[Value]`；删所属表后改为错误引用，依赖 IFERROR 真实运算 | 局部名字遮蔽、复杂表选择器、行上下文及所有名称递归；旧 OA02 局部名字重排证据独立保留 |
| 3D 引用 | 真实顺序下 `SUM(first:last!A1)`；改名保持端点，删除端点缩到剩余有效区间；8 组样本实际重算 | 不任意承诺 3D 引用在所有函数、反向区间、外部文档及复杂名称中的语义 |
| 共享公式 | 由同一 worksheet 的 shared master + `si` 及坐标翻译生成显式公式；跨表引用不会丢掉 | 全部异常 shared 存储、任意百万格展开；正式实现须有组完整性和预算校验 |
| 数组公式 | 固定矩形旧式 array；主格与从属结果都提取、都用独立缓存读取验证；源 `f` 的 array 属性保留 | 动态数组／spill／CSE 特殊函数／dataTable；当前实验对 dataTable 明确拒绝，生产需另做适配，不删需求 |
| 动态引用 | INDIRECT 字符串保持不变；真实引擎在改名／删除后返回错误并由 IFERROR 接住 | 任意动态计算／外部链接／异步函数；外部 workbook 不加载，需独立能力检查 |
| 样式与合并 | font/xf 写时复制、数值和 number format 保留；底层合并从属值保留 | 完整样式面板、富字符串、所有边框／条件格式、字体测量和 Office 全部排版一致 |
| XLSX checkbox | 非宏的旧式 Form Control：`ctrlProps` + VML `ClientData` + Boolean linked cell，绑定与勾选状态真实重开 | Microsoft 新式 in-cell checkbox 格式；控件外观／锚点和已有其他控件族需分别适配。不得把字符串 FALSE 当 checkbox |
| PPTX | DrawingML table 文字、柱状图数值 cache + embedded workbook；局部背景；复制可变 chart/notes，安全共享主版/layout/theme；删除私有依赖闭包 | 9 种图表、全部形状、合并表格／富文本、组合变换、动画／章节／自定义放映、复杂布局、每个交互动作 |
| 包保真 | 每次声明 changed/added/removed；内部关系、Content Types 检查；原包未经编辑的部件按 SHA-256 保全；未知部件删除负对照拒绝 | 任意第三方扩展的语义；签名、加密、XLSM 宏保真另验，宏不执行 |

未知公式存储／依赖／计算失败的处理是：返回带原因的候选失败、保留原件与草稿，继续实现对应适配器和用例。**不能把这条失败保护当成该功能已开发完成。** 本轮支持范围足以确定整体实现路线；全部动作与兼容矩阵仍须按 [R3.4 动作矩阵](实验/r34-office-actions-矩阵与验证.md)逐项实施。

## 4. 交给正式开发的接口和顺序

1. **读入及检查。** 主进程文件服务提供经过身份校验的隔离字节副本、`documentId/baseRevision/operationId/stateVersion`。渲染进程不能给计算桥任意磁盘路径。先检查包体、ZIP 展开量、关系、签名／保护、公式族和操作能力。
2. **操作计划。** 按稳定 sheet/slide/object 身份建立变更闭包；声明会改、会加、会删的部件及公式／对象语义。模型操作日志与 undo/redo 共用这份操作事实，不用简化 JSON 重建文件。
3. **候选物化。** 只修改允许的 XML 节点／部件。共享公式需按组转换，数组范围与从属缓存不能遗漏；图表的数据源、cache、embedded workbook 同步。表／图表／样式共享资源采用写时复制。未知依赖不能悄悄丢弃。
4. **隔离计算桥。** XLSX 使用固定 POI＋可分发 JRE。输入为宿主创建的临时副本和声明的公式结果集合；返回 `formula identity + type/value + engineVersion + operationId`。禁止模型消息、用户宏、外部工作簿加载或任意文件读写。样本桥采用单次子进程、`-Xmx512m`、30 秒硬超时；正式进程资源限制、取消／杀进程、请求代际校验和大文档预算按 09／07 接入，不把 Java heap 上限误说成总进程内存上限。
5. **提取和门禁。** 从计算候选只取声明的 `t/v` 及数组结果，保留精确适配后的公式与原包其他内容。计算例外、结构化公式被改写、回执实例不符、未知丢件都拒绝；计算引擎整包输出永不直接作为保存原件。
6. **安全保存。** 候选通过后进入 R07.17 保存 broker；沿用串行、幂等、草稿／日志、提交后冲突保留。成功回执只能清除相同版本的 dirty，最新输入 flush、关闭和重试在 App 接入时验证。
7. **即时复验。** 每实现一个动作族就用真实文件重开；接入后的撤销、切文件／切任务、中文输入、外部改动、崩溃／满盘与安装包用例逐项执行。未经实际测试的能力保持未完成。

本轮代码是**研究样例**：Python + Java 为快速复现依赖语义与文件保真的工具，不要求生产引入 Python。生产可复用算法和 fixture，在现有 TypeScript/native broker 架构中落地；Java 桥只承担 POI 的隔离职责。旧式 checkbox 插入用引擎生成的控件闭包作为候选，再按声明部件提取；本轮已经证明真实格式及精确 toggle，通用控件 ID 分配、锚点映射和插入事务仍属实现。

## 5. 资源、来源和复现

- POI 固定 **5.5.1**，13 个运行 JAR，共 **19,676,461 bytes**。逐 JAR 官方 Maven Central URL、SHA-256、源仓库 SHA-1 校验结果见[依赖清单](实验/predev-office-dependencies.json)。13 个源 checksum 都匹配；没有宣称做了发布者签名验证。
- 23 份包内 LICENSE／NOTICE／COPYRIGHT 和各 POM 已保存到[分发材料目录](实验/predev-office-dependency-notices/)。顶层 POI 为 Apache-2.0；依赖各按所带声明，不能以顶层许可证代替依赖声明。
- 当前实验 Java 17.0.13，桥代码最低 Java 17；这里不把 Oracle 安装作为可再分发资源。固定 Temurin **21.0.12.1+1** 已由 09 用本轮 `oa12-deleted.xlsx` 与 `rich-delete-final.xlsx` 实跑：3／15 个公式均重算通过，331／386 ms；[JRE 与重算证据](../验收/证据/predev-resources/predev-resources-temurin-poi.json)。官方 archive SHA-256 为 `dec50fc6f9fcd4fe3ae8cabf5a5fa68f6afc48841f7698e468e9aa5d54beed84`，压缩 48,144,965 bytes，展开运行目录 157,631,121 bytes；仅本机 macOS arm64 已执行，其他平台不能沿用该结果。没有修改项目 package.json，也没有安装全局依赖。
- LibreOffice **26.2.4.2**，build `0229ac93fcf0d7cbc6376066c6f35021cef002dc`；openpyxl **3.1.5**、lxml **6.1.1**。全部文件为自建合成资料；原始用户文件、凭据、Codex 应用均未读取。

官方依据（2026-10-17 核对）：[POI 发布与 Maven 坐标](https://poi.apache.org/download.html)、[POI 公式计算与缓存规则](https://poi.apache.org/components/spreadsheet/eval.html)、[LibreOffice CellValueBinding 初始化接口](https://api.libreoffice.org/docs/idl/ref/servicecom_1_1sun_1_1star_1_1table_1_1CellValueBinding.html)、[openpyxl 公式平移与依赖边界](https://openpyxl.readthedocs.io/en/3.1.1/editing_worksheets.html)。第三方 API 文档仅说明能力；具体通过／失败以本次文件和结果为准。

复现命令（从仓库根执行；每次使用全新输出目录，保存旧结果）：

```sh
# 用已归档 pom/settings 下载至独立目录；不读取用户 Maven settings。
mvn -B -s docs/里程碑/M9_文件浏览工作区/技研/实验/predev-office-dependency-notices/settings.xml -gs docs/里程碑/M9_文件浏览工作区/技研/实验/predev-office-dependency-notices/settings.xml -Dmaven.repo.local=/tmp/predev-office-poi/m2 -f docs/里程碑/M9_文件浏览工作区/技研/实验/predev-office-dependency-notices/pom.xml org.apache.maven.plugins:maven-dependency-plugin:3.8.1:copy-dependencies -DoutputDirectory=/tmp/predev-office-poi/lib

mkdir -p /tmp/predev-office-poi/src /tmp/predev-office-poi/classes
cp docs/里程碑/M9_文件浏览工作区/技研/实验/predev-office-PoiProbe.java /tmp/predev-office-poi/src/PoiProbe.java
javac -cp '/tmp/predev-office-poi/lib/*' -d /tmp/predev-office-poi/classes /tmp/predev-office-poi/src/PoiProbe.java

python3 docs/里程碑/M9_文件浏览工作区/技研/实验/predev-office-run.py --root /tmp/predev-office-new
python3 docs/里程碑/M9_文件浏览工作区/技研/实验/predev-office-variation.py --root /tmp/predev-office-new
python3 docs/里程碑/M9_文件浏览工作区/技研/实验/predev-office-render.py --root /tmp/predev-office-new
/Applications/LibreOffice.app/Contents/Resources/python docs/里程碑/M9_文件浏览工作区/技研/实验/predev-office-checkbox.py --out /tmp/predev-office-checkbox-new
```

真实 LibreOffice 运行需要宿主允许启动隔离子进程；沙箱无法连接 UNO 时应正常申请权限，不能改成 Mock 后记通过。本轮已获工具批准运行。LO 渲染数据只用于上述边界验证，含错误引用的 XLSX 已知限制单独记录。

## 6. 历史和交接边界

- 原 R3.4 OA12 失败、OA14 候选提取以及历史冻结包均未改动。
- 新 probe 的数组 fixture 起初漏写公式前导 `=`，在正式引擎测量前已修正；第一次聚合检查有属性路径笔误，结果保留在 history。数组从属格最初只重算、未提取缓存，已修正为同时提取并用独立缓存读取断言覆盖。没有将这些历史结果覆盖为通过。
- checkbox 首两次实验分别误写只读 BoundCell、误用 PropertyValue，失败记录和当时源码都保留；改为官方 NamedValue 初始化后重开和精确 toggle 通过。
- 04 的前期方案可以交给开发执行；**本 M 是否整体进入开发，仍由阶段入口汇总 03／05／06／07／08／09、既有授权与用户本轮先收口要求后给出结论**。本报告不替其他组宣布完成，不新增用户产品决定。
