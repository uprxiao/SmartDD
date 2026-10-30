# DEV142 查找作用域与弹层 Esc

依据 R3.4/P1、R03.11/R09.6，保留 R18 原 U/I/A、步骤和预期。正式 **253/419（60.38%）**，164未执行、2阻塞；M9验收中，未发布。

## 修复与验证

`FileTextEditor` 原有局部 Meta/Control-F 及现有跳行按钮按焦点工作。R18用真实键盘到达跳行按钮，并检查搜索弹层、编辑器、隐藏面板、另一任务及终端；没有已确认的全局GoToLine加速键，未额外创造按键或声称参考已确认。

生产缺陷 DEV142-01 位于 `search-panel.tsx`：mask 对全部 keydown 调用 stopPropagation，Esc不能到达所属 Base UI 弹层。原 r82 三次 A 均在已有2项通过后停于搜索弹层；细化trace发现8次Tab全部正确重定向，真正超时是随后mask Esc。原生组件 I 为10过1红。现仅在mask实际处理的方向键和Enter拦截，Esc保留弹层处理。共享P `FileWorkspace.jsx` 原本已经按这三个键条件拦截，无需改P。

| 层级 | 实际结果及边界 |
| --- | --- |
| U6 | 原 React/CodeMirror 两编辑器、局部重复查找、外部输入、隐藏兄弟、跳行与Find互斥、openShadowRoot及事件级IME guard；jsdom几何shim/非相关绘制排除，非物理IME |
| I42 | 新R18真实FileService/native/FileBuffer 6 + 正文11（其中新mask Esc 1）+ 请求3 + session22。U/I合计48，新增13，零失败/跳过；不是M9全套重跑 |
| 浏览器U2 | 真实Chromium openShadowRoot，真实pointer/key/Tab/Enter，document.activeElement为host，shadow.activeElement为原编辑器或输入框，跳行取消恢复原选区和深层焦点；合成file API，正常App仅充当浏览器，不作为原生IO/PTY的A证据 |
| A12 | 正常r83浅深各6：Meta/Control-F与重复、Tab/Enter跳行/Find取消、全文弹层8次Tab及Meta-F隔离、隐藏面板、文件可见时终端、切任务。两条input-only Python PTY只收输入，原pty:input为0、真实接收0字节/执行0命令、心跳前进和身份保持 |
| App回归6 | 原progress/spinner/权限错误、普通方向历史/定位/焦点及mask历史在r83浅深复验；原请求/回包/通知观察器恢复，旧driver app.close清理不冒充正常quit验收 |
| 构建 | 完整正常编译/原打包配置及afterPack、同ABI原native模块、六smoke、82运行文件逐字节核对、类型检查通过 |

A12源hash/inode/mtime/ctime不变，全程输入可信，PTY观察器原监听身份恢复；原API停止两自有PTY并一次正常退出0/null。全部7自有UI实例关闭，其余实例仅证明清理，未计正常退出。已查看A深色切任务和浏览器U截图；没有像素/完整P或V新增结论。未访问日常资源/凭据，无模型、剪贴板、外部应用或终端输入执行。

## 失败与环境差异

- jsdom默认Apple vendor使CodeMirror选中Safari selection workaround，原U/I10过2红缺execCommand。一次错误环境配置造成0测试收集及ResourceLoader错误。正确做法是模块导入前匹配目标Electron Chromium vendor/UA，结束还原；没有补造execCommand/选区/焦点。再以真实Chromium U2独立复验。浏览器U首轮导航时DOM未就绪失败，修正驱动等待后通过。
- 首次mask红测传了错误helper路径，主动中止且无JSON，不用于产品缺陷判断；正确native路径10过1红与实际r82A原失败独立支持修复。
- 首轮组合执行缺session独立环境变量，26过22跳过；补变量后普通Node不含Electron original-fs，26过22环境失败。最后用明确 **ELECTRON_RUN_AS_NODE=1** 的r83正常可执行文件跑Vitest，48全部通过，不把跳过或环境失败计通过。
- 新测试ref隐式any令首次typecheck失败，补FileDocument.ref显式类型后通过。该测试类型注解是唯一构建后差异；生产、P、driver输入没改，48项与type复验。

## 可追溯基线及接续

正常包 `/private/tmp/willyou-m9-acceptance-batch-r83-build/mac-arm64/WillYou.app`，macOS arm64，0.0.5，ASAR `21e81d1439177e17b25180a7b9572478097b4f8dbf88309224ed9a93aa2728fd`。broker/watcher与r82相同，未产生安装器或发布。

完整1271源通过DEV1411266父链＋8文件delta（3改5新）恢复；构建冻结与最终源各有manifest/tar。构建后仅上述1测试类型注解变化；所有原包/失败/夹具和最终结果归入[95项证据](../验收/证据/m9-acceptance-find-scope-dev142-r83-20261019.json)，报告SHA256 `20035c0aeb5f87c383cb1d4789c063c62aa233cd53dde1ee44fefce5afb434c7`。父DEV141报告及75项artifact重新核验且未改变。

复用入口：`scripts/files/find-scope-ui.mjs` 指正常包；`find-scope-browser.mjs` 为U浏览器夹具；`find-scope-acceptance.test.tsx` 用 `SMARTDD_M9_FILE_BROKER`；既有session测试还需 `SMARTDD_SEARCH_APP` 并以Electron Node模式运行。[通用CDP流程](../../../真实App自动验收流程.md)已补焦点守卫、键事件冒泡、ShadowRoot指纹及证据层级，后续M复用。

R18已结案；其余164未执行、2阻塞继续按原层级推进，系统/物理IME/完整参考V/平台边界及DEV139-OBS01/DEV111观察未代填。可继续D19滚动/选区/恢复及生命周期用例；先核对现有持久化契约，不因已有运行时scrollSnapshot推断重启也保存。
