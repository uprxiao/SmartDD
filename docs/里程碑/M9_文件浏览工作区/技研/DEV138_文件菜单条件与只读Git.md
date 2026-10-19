# DEV138 文件菜单条件与只读Git

依据R3.4/P1，E11原P/I/A及步骤预期不变，完整通过；正式249/419（59.43%），168未执行、2阻塞。E10仅I补证，尚未整条通过。不改生产/native/依赖，复用r79，不发布。

## 验收与实现

| 层级 | 实际结果 |
| --- | --- |
| P16 | 完整共享FileWorkspace，浅深各8组。文本/Markdown适用换行、复制、只读归属及源码/文档切换；行号2预览时条件相同、取消不改正文；实际PNG解码及二进制不显示文本类动作。明确合成的Git变化状态、归属示例及generated筛选，package.json被筛去，src/main.ts保留；不冒充真实Git |
| A16＋A1 | 正常r79原UI/原native鉴权文件，浅深各8组；实际Git ready/作者M9 menu fixture/linguist-generated属性及真实筛选。单独非仓库目录原回包unavailable、归属入口禁用。无提交/分支/合并/推拉产品入口 |
| I4 | 新3条实际包内broker/FileService/metadata/store/buffer：四类型实际classification及editor权限、真实status/generated/blame/index不变、非仓库无能力；另复跑原所选1条native状态/属性。该原文件其余测试未选，不计全套通过 |
| 额外I9 | 既有E10/H24真实保存模式切换测试重跑；成功/冲突、切文件/切走再回、更新模式意图和新保存迟到隔离。E10仍缺完整P/A状态及独立滚动验收，保持未执行 |
| 核对 | P工作区模型41、Sites4、类型、最终原型build、82运行文件比较通过。包/native同哈希，原六smoke复用，无新生产包；最终P/A/无GitA三次退出0/null，9自有实例全闭 |

原型旧菜单对图像/二进制无条件显示文本换行、复制及归属，真实P红测5项后在pixel.png失败。FileWorkspace.jsx按实际类型和SVG源码状态增加textMenu条件，保留既有外开/路径等入口；无布局、字体、颜色或新业务变化。生产原本以buffer.editor条件控制，这次无需改生产。

复制菜单仅核对适用性，不点击，不触及系统剪贴板。自有合成Git仓库由夹具初始化提交，在App运行前完成；不是产品Git写入口。App源文件hash/inode/mtime/ctime以及index SHA前后相同，无模型、CLI任务或外部应用启动。P的native磁盘与Git结果不能据此通过，由独立I/A证明。

## 保留的失败与复跑边界

- 初I三条在夹具setup失败：Git -c需要单个name=value参数，已修驱动；不是三条产品失败。
- 原型修复后P14菜单已过，结束时从http原型来源调用tasks.list被原sender拒绝；修正为先回原file页面再查任务，未放宽安全校验。
- 首App四项后失败是驱动只认显示Git行归属，而已启用状态实际叫隐藏行归属；下一轮七项后失败是generated选择器嵌套引号语法。分别保存原结果及驱动快照，修驱动后完整A16通过。
- P14之后补齐同一原范围的合成状态/generated检查，夹具明确保留package.json/src/main.ts，最终P16。后续只改P测试分支与合成数据，A分支及产品字节未改，原A16实际驱动与源tar保留，不重复A。此前P14草稿报告及其84项前期资料保留于单独pre-extra存档；最终报告以下方102项为准。
- 首pnpm原型build因本地无vite bin失败；沿用既有npm run build解析祖先安装的Vite6.4.4成功，未改依赖或安装。目录依赖声明与实际版本分开记录。

查看了最终P深色二进制菜单（补generated前同源码）及A深色PNG菜单；没有R/V精确像素结论。当前1247源可由1243基准＋6文件增量恢复。旧错误/失败不删除，后续未执行用例及系统/人工/参考/平台限制保留。

## 入口

- A/P驱动：`scripts/files/viewer-menu-ui.mjs`。`WILLYOU_FILES_APP`指向正常包；`WILLYOU_MENU_PROTOTYPE=1`测试本机4176完整共享原型，`WILLYOU_MENU_NO_GIT=1`测试无仓库来源。
- P合成入口：`prototypes/m6-codex/tests/viewer-menu-runtime.html`及`viewer-menu-harness.jsx`。
- I：`src/renderer/features/files/viewer-menu-native-acceptance.test.ts`，用`SMARTDD_M9_FILE_BROKER`指定包内helper，可用`SMARTDD_VIEWER_MENU_EVIDENCE`留原始观察。
- [原始102项证据](../验收/证据/m9-acceptance-viewer-menu-dev138-r79-20261019.json)；[通用自动验收流程](../../../真实App自动验收流程.md)。
