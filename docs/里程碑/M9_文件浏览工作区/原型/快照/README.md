# M9 可恢复基线与证据归档

当前业务原型冻结基线为 **R3.4-20261017**，新增开发前工程资料 **R3.4-P1-20261017** 见文末；分支`feature/0.0.1`，Git基础`d75bbaa81e924d1f9a9509ae1d068d69d4ea8ec7`加未提交增量。用户已授权处理九项问题，本轮原型、文档、现有App的PTY专项修复及实验分别归档，见本页R3.4表；完整M9功能与打包验收未完成。D01/D07/拖完整路径继续有效，产品待决0。旧归档逐字保留，不用活动预览地址代替历史版本。

R3.3冻结后的文档补记：用户随后明确请求REA/Computer Use核查，新增[九项验证路线与首项复核](../../调研/九项验证路线与首项复核.md)，同步当前授权说明并纠正Y27预期中的旧措辞。业务范围及原型源码不变，当前文档包含此未提交增量，不再与本页冻结的R3.3资料ZIP逐字相同；旧ZIP/manifest不覆盖，历史实际结果不变。

| 基线 | 源码归档 | 文件数／bytes | SHA-256 | 清单 |
| --- | --- | --- | --- | --- |
| R1历史 | [R1 ZIP](M9-R1-20261017-prototype.zip) | 44／1485842 | `02c9005df74e6e65ca92946637ff35f1ce5ad2f7a7381ee75c114b1e5d67c868` | [R1 manifest](manifest.json) |
| R2历史 | [R2 ZIP](M9-R2-20261017-prototype.zip) | 60／1553303 | `4f0a727f13d75fdde0fc39942ca35b2ff1b4083ec7300c2d40a3a6922bbef152` | [R2 manifest](manifest-r2.json) |
| R3业务基线 | [R3 ZIP](M9-R3-20261017-prototype.zip) | 79／1736378 | `20c936857975c091a28c862167a056e8bb1a7ddb8e516c98521a3761829b8037` | [R3 manifest](manifest-r3.json) |
| R3.1历史文档同步 | [R3.1 ZIP](M9-R3.1-20261017-prototype.zip) | 79／1736007 | `bcb16fe0090e72736ea1d3b7ee7e4577dd5b44e3ce1378eee9765793bf78b330` | [R3.1 manifest](manifest-r3.1.json) |

R2包含新增搜索/Markdown/Office/PDF/Notebook组件、模型与测试、合法图标和合成图片资源。101项M9模型、5项既有模型、4项托管检查及构建通过；20组REA和3项补充浏览器检查的具体范围见[证据索引](../../验收/证据/README.md)。R1仍保留当时22项模型与有限UI历史，不升级其结论。

归档不含node_modules、dist、私有反编译源码、REA原始bundle或真实用户数据。恢复时先校验ZIP与manifest，再解压至临时位置的`m6-codex/`，逐文件校验后按package-lock恢复依赖；不要直接覆盖正在开发的共享原型。后续确认或开发提交时追加对应Git commit。

R3 相对 R2（含第二批 PDF/Notebook/交互修复，快照已重生成）：Markdown 渲染换为 markdown-it/KaTeX/Mermaid/js-yaml，新增 `file-markdown-render.test.mjs`，更新 package.json 与 package-lock.json（精确锁定，lockfileVersion 3）、两份 Markdown fixture 与样式；128 项 M9 模型、5 项既有模型、4 项托管检查及构建通过；Markdown 18 项、PDF/Notebook 23 项、交互矩阵 30 通过/7 未验证的浏览器检查见[证据](../../验收/证据/README.md#r3-markdown-取证)。R3 仍为候选，未获用户确认。

第二批新增：`FilePdfCanvas.jsx`、`file-pdf-model.mjs`、`file-pdf-engine.mjs`、`file-ime.mjs`、`file-highlight.mjs`、两个测试文件、`public/assets/m9-pdf` 的合成 PDF 样本；快照不含 node_modules 与 dist，恢复需 `npm ci`（lockfileVersion 3）。

第三批新增（快照已重生成）：`file-reference-model.mjs`、`file-viewer-policy.mjs`、对应两个单元测试、`FileWorkspace.jsx`/`App.jsx` 的引用托盘与终端插入/审阅逻辑、相关 CSS、`fixtures/控制字符.txt` 测试数据与 AGENTS.md 说明；模型 145 项通过。

R3.1（2026-10-17）仅修改原型工程中的 `AGENTS.md`、`README.md`、`design-qa.md` 三份说明，统一当前统计、阶段授权和不再操作/查看Codex的最新约束；其余76个归档文件的字节与R3完全一致，包括业务源码、依赖、测试与资源。未用新文档归档声称新跑过浏览器或构建；145/5/4项检查是同日先前审查的实际结果。阶段需求、技术方案和用例不在该原型ZIP内，另见[阶段入口](../../README.md)及其R3.1资料基线。R3原ZIP与manifest均保持原样。

## R3.1 评审资料基线

[评审资料 ZIP](M9-R3.1-20261017-review-documents.zip)与[逐文件清单](manifest-r3.1-documents.json)另行冻结37份文件，包含阶段Markdown、417条用例JSON及维护脚本、实验索引、共享规则/导航、原型说明及两次审查报告；479992 bytes，SHA-256 `c0ec511f4913a82f17857096223ed41e0c866b4e6ad01b4370d52e6d954a879e`。归档路径相对仓库根；恢复先在临时目录验证，不覆盖当前工作区。

为避免自引用，此快照说明自身不在资料ZIP内；原型业务源码、截图与实验结果载荷沿用各自的独立归档和证据索引，不因资料归档重新取证。该基线仍是待D01/D07与整体设计评审的候选，不能当作用户批准记录。后续用户决定或方案变更另建修订与基线，不覆盖此次包。

## R3.2 历史候选基线

2026-10-17 用户确认 D01（终端与磁盘视图独立，无专用 CLI 修改审阅）并追加 R05.14（从右侧拖文件/图片到终端插入完整路径）。本轮同步需求、方案、原型与用例，原417条保留，新增Y33–Y40后为425条/23组、102个子需求；全部正式App用例仍未执行。

| 基线 | 归档 | 文件数／bytes | SHA-256 | 清单 |
| --- | --- | --- | --- | --- |
| R3.2 原型 | [原型ZIP](M9-R3.2-20261017-prototype.zip) | 81／1742025 | `6cacd36871b25d9ba6865ec444bade0c27e57ec6df28838b06c8a2dd1622194a` | [manifest](manifest-r3.2.json) |
| R3.2 评审资料 | [资料ZIP](M9-R3.2-20261017-review-documents.zip) | 38／506936 | `084e1f3f3cbd0787d2d3c4a0fe08a7ab710cc014cee4a7cead79e269cbed3f4c` | [manifest](manifest-r3.2-documents.json) |

原型模型155/155、既有模型5/5、托管4/4与构建通过；独立浏览器24/24，3张截图哈希核对一致，见[执行记录§12](../../验收/执行与缺陷记录.md#12-r32-d01-终端与文件视图独立)。原型ZIP内路径以`m6-codex/`开头；资料ZIP相对仓库根。先在临时目录校验和恢复，不覆盖正在开发的工作区。真实CLI/语音、磁盘服务、原生拖放、打包与跨平台未验。

资料ZIP含本轮与历史报告，排除本README以避免自引用；新截图/浏览器载荷仍位于[证据索引](../../验收/证据/README.md)，17份既有技研实验报告不因新增浏览器报告改算18份。旧快照保持原文件与哈希。D01与R05.14的方向确认不代表整个M9已获正式开发授权，D07仍待决定。

## R3.3 历史候选基线

2026-10-17用户确认D07=A，仅本机IDE式文件区。D01/D07两项产品决定均完成；保留左侧终端、右侧文件树/渲染/编辑和拖完整路径，移除远程模拟分支。425条总账分为419条本期、6条纯后续；4条混合用例只验本机分支。整体设计及关键工程仍待收口，正式App未实施。

| 基线 | 归档 | 文件数／bytes | SHA-256 | 清单 |
| --- | --- | --- | --- | --- |
| R3.3 原型 | [原型ZIP](M9-R3.3-20261017-prototype.zip) | 81／1743119 | `40b4dfb5798b055ec63c388de1f7f1ac4cb706df40f03894fb061efb087427a2` | [manifest](manifest-r3.3.json) |
| R3.3 评审资料 | [资料ZIP](M9-R3.3-20261017-review-documents.zip) | 39／531949 | `789584b73b06b90b301254a86d6e3e80af45c6646423fff4b6811f0921c46e4f` | [manifest](manifest-r3.3-documents.json) |

本轮受影响浏览器5/5、原型构建、用例索引和资料链接检查通过，1张截图哈希匹配；旧155项模型和24项浏览器结果未重跑。详见[执行记录§13](../../验收/执行与缺陷记录.md#13-r33-d07-确认仅本机文件区)。档案路径与恢复办法同R3.2，排除本README以避免自引用。R3.2及此前快照保持原文件和哈希，后续提交时补充Git关联。

## R3.4 用户授权后的专项修复基线

2026-10-17。对应[九项处理结果](../../九项问题处理结果_R3.4.md)及[执行记录§14](../../验收/执行与缺陷记录.md#14-r34-用户授权后的九项专项修复)。最终原型192模型、parity5、sites4及构建通过；Markdown26、目录交互30、PDF/Notebook18、Office评论13项浏览器检查按各自范围记录。现有App的PTY修复另有40项相关测试/6项真实原生探针及App回归；Office依赖新实验保留1项引擎失败，不宣称九项全部关闭。

| 归档 | 文件数／bytes | SHA-256 | 清单 |
| --- | --- | --- | --- |
| [共享原型](M9-R3.4-20261017-prototype.zip) | 299／3411203 | `1fb569a1ec972eb1c6781485d7377e2fd552537bf9b01cb75a111a96ea5727d4` | [manifest](manifest-r3.4-prototype.json) |
| [需求与交接文档](M9-R3.4-20261017-documents.zip) | 53／606595 | `52f0afb20057cb9e393f765a35291ce5bdcf0a9500f9249e6d892ba54d6473a4` | [manifest](manifest-r3.4-documents.json) |
| [生产PTY修复源码与测试](M9-R3.4-20261017-implementation.zip) | 11／31228 | `852bb9e9900a91ed35ae7cde336afd3ae5ae967937326d5e42bcc6934dad337a` | [manifest](manifest-r3.4-implementation.json) |
| [实验源码与实际证据](M9-R3.4-20261017-evidence.zip) | 280／13911229 | `fecc3d6f41404517a42a6e5a0369816c5a4b5a21bf576f47468a16dc4eb9cc6b` | [manifest](manifest-r3.4-evidence.json) |

原型ZIP使用`m6-codex/`前缀，其余归档路径相对仓库根。生产归档仅含本轮11个源码/测试文件，须配合记录的Git基础，不是可独立运行的完整App。证据包收录实际脚本/报告JSON/截图/输出及历史失败，包括受通用忽略规则影响的本轮日志；不含私有反编译源码、用户文件、依赖目录或安装引擎二进制。临时依赖需按报告固定版本/锁文件恢复。

本README及最终校验JSON在冻结后生成，刻意不纳入文档/证据ZIP以避免自引用。正式425条稳定编号和实际结果不变，本期419/后续6仍未执行；H19/H27/Y02/Y27/Y29仅修正契约/关联，不把实验填为正式通过。30项目录交互检查之后仅给两处FileWorkspace增加path透传，旧源码已按原哈希恢复到证据包`r34-history/`，Office13项与最终源码manifest记录后续增量。

恢复先解压到临时位置、核对每文件SHA，再与当前工作区比较；不要覆盖用户或其他Agent的未提交修改。后续修改新建修订，不覆盖本轮ZIP或manifest；提交后追加关联commit。最终校验见[结果](../../验收/证据/r34-final-verification.json)。


## R3.4-P1 开发前工程资料（2026-10-17）

业务需求及产品页面仍以R3.4为基础；P1归档当前用户要求的04/09/03/07/05/06/08前期实验、契约、资源锁与验收参数，没有新完整生产接入。当前6项前期完成、03主体完成但物理IME受工具限制，01/02参考限制另列；详见[执行账](../../开发前目标与执行记录.md)。

| 归档 | 文件数／压缩bytes | SHA-256 | 清单 |
| --- | --- | --- | --- |
| [P1开发前资料](M9-R3.4-P1-20261017-predevelopment.zip) | 490／3528500 | `6ea94ceff6eb75e7930896f933653ce6052aaf4f8912b6c7db567f00d76cd004` | [P1 manifest](manifest-r3.4-p1.json) |

归档路径相对仓库根，包含7份专项、当前需求/用例/交接、独立实验代码、合成样本/截图/失败历史、版本锁和许可材料；不含node_modules、原生引擎二进制或私有Codex内容。共享产品原型与既有生产PTY修复沿用R3.4包，P1实验源码另收录。先解压到新临时目录并按manifest校验，不覆盖当前工作区。未提交增量基于feature/0.0.1的d75bbaa81e924d1f9a9509ae1d068d69d4ea8ec7；提交后再追加关联，不重写旧包。

较大的已验证原生试包另保留在忽略目录 [本机试包](../../../../../release/m9-research/predev-p1/willyou-native-resource-trial.tar.gz)，159985045 bytes，SHA-256 `7d740ab24b26942a6ab4b8fb47eb07bacdb02fae5d5f936c7209450a10713afb`。它包含TeX/JRE/POI，未含LibreOffice/Electron，不是WillYou安装包。恢复资源可用此包或按09固定源及清单重建；[保留记录](../../验收/证据/predev-native-trial-preservation.json)。

[最终完整性结果](../../验收/证据/predev-final-verification.json)：591个本地链接无缺失，149/58/219文件的三个专项manifest匹配；14个Python、16个MJS与77份当前JSON检查通过；四个R3.4 ZIP原SHA不变。425条正式ID、需求映射、范围、实际结果/状态/证据/缺陷保持原值，仅修正Y29/Y30定义混淆。当前README和最终核对JSON不入ZIP以避免自引用；这只是归档校验，不是新App测试。

## Git 提交关联（2026-10-17）

用户要求将当前工作提交并推送后，以上基于 `d75bbaa` 的未提交增量已在 `feature/0.0.1` 保存为以下提交；前文的“未提交”描述保留为冻结时的历史事实。旧 ZIP、manifest 及验收结果未改写。

| 提交 | 保存内容 |
| --- | --- |
| `a38a00b6e50f2af73b9fc6d1c00c703f16d294a6` | 11 个现有 App PTY 权限、任务归属及生命周期修复文件，与 R3.4 实现快照逐文件一致。 |
| `e7432f1ca0bffdb8bb0d0ff7c813e627beeb63d8` | 阶段目录迁移、M9 需求／用例／研究／证据／P1 资料、共享 M9 原型及已有 M10 设计增量。299 个 R3.4 原型文件与 490 个 P1 文件均匹配原快照；10 份被引用的 M9 日志已纳入 Git。 |

提交前重新执行 App 类型检查、构建及 50 项相关测试；共享原型 M9 192 项、parity 5 项、sites 4 项、M10 模型 8 项及构建通过。用例索引检查通过。许可证、原始日志、PDF 样本及已冻结源码中的既有空白保持原字节，未为格式整理改写证据哈希。提交不代表完整 M9 已开发完成，425 条正式验收状态保持原值；本次未合并 main、打 tag 或发布。
