# DEV139 Markdown模式切换与滚动恢复

依据R3.4/P1，E10对应R05.3/R07.8，原P/I/A、步骤与预期不变；正式250/419（59.67%），167未执行、2阻塞。本批不发布，M9尚未开发完成。

## 问题与实现

旧实现同一buffer只留一份滚动快照。正常r79原包真实滚轮分别滚动文档与源码，回文档后原段落2变第27节，源码锚点643变15888。不是只凭源码推测：原包A红和只读可见块/viewport数据保留。按buffer+mode分别存原CodeMirror `scrollSnapshot`、实际Text身份、双轴像素；以mode为FileTextEditor的DOM key，旧view销毁在新布局前完成，原EditorState、buffer、选择和undo仍保留。仅旧view拥有焦点时交接，不从其它控件抢焦点；失败不切mode，也不销毁原view。

r80主流程A14通过，但补充在源码实际末尾追加后，回已滚动文档仍从anchor643变3674（段落2变第7节）。编辑使旧Text身份失效，仅像素回退在虚拟富文档里不足以恢复原内容。FileBuffer接受真实transaction时，按ChangeDesc映射inactive mode的源码锚点，保留viewport边距。若锚点所指内容已删除，不继续冒用语义快照，仅保留双轴像素fallback；EOF使用TrackBefore，其余使用TrackAfter。此边界单位测试曾红，原结果保留，最终70项相关U通过。没有直接改编辑器内容/历史以实现恢复。

主要源码：`src/renderer/features/files/editor-scroll.ts`、`file-buffer.ts`、`text-editor.tsx`、`workspace-panel.tsx`。同级`editor-scroll.test.ts`与`workspace-panel-focus.test.tsx`验证身份、映射、删除fallback和mode替换/焦点边界。

共享原型FileWorkspace补按tab身份+mode的位置、显式“保存中（合成）/完成保存（合成）”及过期意图校验。原型openFile在仅激活既有且preview属性不变的tab时保留原实例；旧无意义clone会使切走再回后的原保存示例被判过期，实际openFile模型红与完整P红后已修复。仍保留当前选择意图判断，旧切换不因返回而复活。P所有IO状态是合成，实际native结果由I/A另证。生产不依赖P模型模块。

## 最终验证

| 层级 | 实际覆盖 |
| --- | --- |
| P12 | 完整共享原型浅/深色，clean各模式非零滚动/横滚；dirty、saving、failure/重试、等待中切走/切走再回。保存明确合成，不冒充磁盘 |
| A14主流程 | 最终正常r81浅/深色各7项，真实保存前保持原mode；同一已有save等待；自有根0500真实原生失败后0700恢复/重试；原保存迟到完成不切其它文件或已过期mode；原源码和真实磁盘字节核对 |
| A2另轮补测 | 1个重复clean控制＋1个新自然EOF编辑；先使两mode非零滚动，真实键盘到EOF且collapsed选择确认，插入单行文本，真实保存切回文档仍恢复原内容及viewport，源码回编辑后位置/横滚。与A14共15唯一检查，不写成单轮16全绿 |
| U/I | 70相关U（其中新5滚动+1真实panel测试）；9真实包内native/FileService/store/buffer I。去重79，不叠加中间重跑 |
| P模型/构建 | 48模型（原41+新7）、Sites4、类型、最终原型build通过；源码1253与最终构建逐项相同 |
| 包与回归 | r81正常完整编译/打包及原六native smoke，82运行资源逐字节比较；E11最终r81 A16及当前P16通过，另r80 A16留存 |
| 清理 | 最终选定P/A主/补测/菜单P/A五次正常退出0/null；全部22个自有实例退出，原输入及5个RPC观察器恢复。菜单复制只检查不点击，源/Git元数据不变 |

虚拟CodeMirror不能用估计总高变化后的scrollTop绝对值直接判恢复；本次核对相同源码anchor、yMargin、前两可见块身份/内容和相对viewport位置（2px内）、实际横轴。P非虚拟DOM另按实际top/left（2px内）。最初像素断言和滚轮动画途中取样失败均保留，没有直接放宽为“看着一样”。看过最终r81深色dirty及P浅色saving截图（保存完成状态），无R/V精确Codex像素一致结论。

## 失败、额外观察与边界

- r79产品滚动红，r80末尾编辑产品滚动红，最终r81绿分别保留。D仅开发诊断，不计A。首次编译在受限环境LibreOffice签名核对失败；正常权限codesign验证有效，正常完整build成功；正常codesign输出未单独落盘，不补造文件证据。第一次D误在编译结束前启动而读到旧renderer，明确排除修复证明。
- 原型textarea普通Meta+A未真实全选、原生select点击及Enter未提交，造成复制文本和错误场景前置；改驱动为实际CDP selectAll命令并断言selection，再用可见的明确合成场景按钮，不直接写DOM value或store。全部原失败与已有驱动快照保留；某些最早修订当时未逐版保存，不虚构精确历史快照。
- 单位测试最初模式隔离2红，模型实际openFile返回1红，编辑映射删除EOF边界1红，最终均有相应绿测。中间r80包/源清单及各轮结果保留，不用最终源码冒称旧执行版本。
- **DEV139-OBS01仍未分类/解决**：一次`Input.insertText`在EOF插入带首尾LF的文本，观察到边界少1个LF；当时只确认head到EOF，未确认anchor。尚未证明来自工具、selection或产品。原BYIzru失败结果含实际raw，合成源另归档。后续单行自然末尾编辑同时确认anchor/head且用来检验E10滚动映射，**不能证明LF观察已修复**；后续输入/EOL用例继续定位。
- 原保存门闩只在dispatch前延迟本次原请求，原native数据/回包未改；真实chmod故障仅本次合成项目。没有模型、外部应用、剪贴板或CLI任务操作；包smoke的隔离PTY探针由原脚本执行并退出。
- Y14/Y17参考V、X03精确R、系统IME/剪贴板/平台及DEV111巨型滚动观察等原缺项保留，未因本批成功消除。

## 构建与可恢复证据

r81 macOS arm64版本0.0.5：`/private/tmp/willyou-m9-acceptance-batch-r81-build/mac-arm64/WillYou.app`。ASAR `e90396c7a0769770d9057d56311a2af8c8dcb9a4ed36006f2b0e4699372e5e02`。native/deps/config未变，先验证现有Electron ABI，再执行原完整build、electron-builder配置/afterPack和六smoke，无冗余native重编译；未生成正式安装包或发布。

完整1253源manifest及14文件增量（8改6新）以DEV1381247源链为父，哈希、增量tar逐项核对通过。没有复制整套App或日常profile；原型夹具与测试项目仅合成文件。最终报告SHA256 `7baf95fdae1651206ee46d90979e60441f688cf95050660325fdd84f1de21073`，含220项证据。

- [原始报告及所有层级/失败/日志/截图/源增量](../验收/证据/m9-acceptance-mode-switch-dev139-r81-20261019.json)。
- 驱动` scripts/files/mode-switch-ui.mjs`：`WILLYOU_FILES_APP`为正常包，`WILLYOU_MODE_PROTOTYPE=1`为完整共享P；`WILLYOU_MODE_ONLY=dirty-scroll`为独立追加编辑补测；`WILLYOU_MODE_DEV=1`仅D诊断。
- [通用CDP流程](../../../真实App自动验收流程.md)已加入本批虚拟滚动、映射、focus、原生控件输入及构建成功边界，供后续M复用；AGENTS/CLAUDE继续链接同一流程，没有第二套规则。
