# F22：Codex 文件工作区实现证据

需求入口：[M9 文件浏览工作区](../需求.md)。技术入口：[F22-A 文件模块迁移](../技研/REA调研与迁移方案.md)。本文保留实现取证；产品范围以 M9 需求为准，迁移步骤与技术建议在 F22-A 方案维护。

调研日期：2026-10-16。范围：文件目录、文件标签、文档/源码视图及文件读写链路。仅调研；没有修改 SmartDD 运行功能。

## 结论与边界

Codex 截图中的区域可分解为普通桌面应用可实现的模块：可调整宽度的工作区面板、带状态的标签控制器、按需查询的目录树、类型分发器、文档/代码编辑器、受控文件服务。文件浏览本身没有发现依赖不可替代原生组件的证据，SmartDD 可按相同职责重新实现。

复杂度集中在状态连续性和编辑安全：单击临时预览与双击固定、切换文件后保持滚动位置、外部修改同步、未保存内容的关闭与模式切换、路径根与远端主机隔离。若只实现树和 Markdown 渲染，不能称为完整复刻。

本报告的“观察”指对发布包 JavaScript 语法的静态观察，不表示在实际 App 中执行过该分支；“迁移建议”是 SmartDD 设计建议。没有读取用户聊天、登录数据或工作区文件内容，没有触发原 App 的文件写入。许可证与可复用依赖版本仍需后续确认，不建议复制提取的专有 bundle。

## 标的与复查方式

实际文件：`/Applications/ChatGPT.app/Contents/Resources/app.asar`；包标识为 `com.openai.codex`，版本 `26.1007.30912`、build `20156`。目录名是 ChatGPT，不能据此把本次发现推广到另一款独立 ChatGPT App 或 chatgpt.com。

ASAR SHA-256：`75e397e2280dde93b70a85aa926f4282c728eacc84dfeb15ba7fb6ddd84628af`。

原始模块保存在被忽略的 `release/f22-research/extracted/webview/assets/`。可读格式化副本位于 `release/f22-research/file-formatted/`；下面的 `L` 行号均指该副本，不是原始源码行。`app-initial` 中混淆符号只对这个包版本有效。

[file-source-locations.json](证据/file-source-locations.json) 保存逐模块 SHA-256、ASAR 成员偏移、原始 UTF-8 字节锚点、格式化文件哈希与工具版本。文件区域模块格式化方式为 `esbuild 原始文件 --format=esm --outfile=目标文件`；下面补充的主进程行号来自首轮调研提供的 `release/f22-research/formatted/.vite/build/main-CqEoQDOU.js`，与 `file-formatted/` 分开标明。原 ASAR 的 21,089 个成员中没有 `.map` 文件，注释里的 sourceMappingURL 不能恢复 TypeScript 源码。该 JSON 不含原始实现代码；`release/` 中的 bundle 不应提交或分发。

## REA 证据账本

| 编号 | REA Evidence ID | 操作与覆盖边界 |
| --- | --- | --- |
| E-F1 | `ev_55b47eb3b7d655b1b283aa58cb63e6f09ef003fc94e7392f92d84e78cb0a1ed0` | `analyze_javascript_application`，对 `file-analysis-input` 的 10 个原始文件模块做静态分析；不包含大体积 `app-initial` 与全部依赖。完整响应超过 MCP 10 MB，服务端保留了 Evidence。 |
| E-F2 | `ev_ecab905bedca9e9bacdc8b93a2234809485578e139bf1af1505f07edb8c1f35e` | 对 E-F1 的 `review-file-tree-side-pane-efa4c8cabba2.js` 做 outgoing module trace；2 个种子、65 个节点、285 条边，`complete-within-source`。 |
| E-F3 | `ev_3a86b592b3d79713006c9afa3b8e1e2fbe03009f8482bbf7e3cb47d81300b073` | 对 `workspace-directory-entries-query` 与 `text-file-storage` 两个原始模块补充分析。 |
| E-F4 | `ev_c89dffb222f4bcfcb9d289f517e65e3d1cd7a406dd802ff3d21451d10942d376` | 在 E-F3 中以 string 种子 `workspace-directory-entries` 精确追踪未匹配。只是 REA 图未建出该种子，不能推断包中不存在该查询；模块正文有明确调用。 |
| E-F5 | `ev_4536eb473fb4ff7aae7c4ef0a0b96145d3b1940a92ca484663773b5bd519c443` | 对 E-F3 的 `text-file-storage-2de491513fbc.js` 做 outgoing module trace；2 个种子、13 个节点、27 条边，`complete-within-source`。 |

REA 的图关系用来核对模块关联；具体参数、分支与常量以下列人工逐函数核对为准。裁剪树之外的 import 被标成 unresolved，不能把这一边界描述成完整应用调用图。E-F3 的 Electron IPC 计数为零：这个裁剪模块只调用封装的查询函数，不代表应用没有 IPC，也不能直接将下述查询名字称为 Electron 原始 channel。

文件调查使用独立 REA 连接，其完整 Evidence 已单次导出到本机 `release/f22-research/rea-file-bundle.json`：5 records、0 ledger unknowns、164,672,755 bytes，SHA-256 `142270cb828889f4c108f705bcf4fecc8e19fa194d72271825096b78e7d44361`。0 ledger unknowns 仅是工具记录计数，不表示本报告列出的未知问题已解决。该大文件含发布包静态证据，留在忽略目录，不随调研文档提交或分发；其他代理的连接导出不能替代它。

## 1. 文件树到目录服务

观察链路：`review-file-tree-side-pane` 的 `wn` → `Tn` 选择根目录 → `qt` 管理树状态 → `workspace-directory-entries-query` 汇合目录记录 → `base-file-tree` 渲染。

| 部位 | 静态观察 | 来源 |
| --- | --- | --- |
| 根目录 | 支持多个 root；多 root 时出现选择下拉；当前文件能反向选择其所属 root。`includeHidden: true`。 | E-F1/E-F2；`review-file-tree-side-pane-efa4c8cabba2.js` L373–399 |
| 目录请求 | 参数是 `hostId, workspaceRoot, directoryPath, includeHidden`；`refreshKey` 参与缓存键。根请求使用 `directoryPath: null`。 | E-F3；`workspace-directory-entries-query-70873766e7c6.js` L13–25 |
| 按需加载 | 根目录和每个已展开目录分别查询，结果以 Set 合并；目录在树模型中编码为末尾 `/` 的路径。没有在 UI 首次挂载时递归扫描全盘的这条链路。 | 同上 L4–8、20–26；`review-file-tree-side-pane` L236–239 |
| 缓存 | `workspace-directory-entries` 的 `staleTime` 为 `FIVE_SECONDS`，有 `placeholderData` 保留前值；带 AbortSignal。 | `workspace-directory-entries-query` L17–18 |
| 树状态 | 按 `hostId + environmentId + includeHidden + root` 保存 `expandedPaths, scrollTop, searchQuery, selectedPath`；100 ms 延迟写回 UI 状态，卸载时 flush。该层未证明重启后持久化。 | `review-file-tree-side-pane` L84–166、258–260 |
| 当前文件定位 | 切换文件时自动展开父目录并选中；保留当前 scroll 与 selection 的引用，避免每次渲染重新初始化。 | 同上 L149–159；`base-file-tree` L382–400 |
| 实时更新 | `git-repo-changed` 且 `changeType === working-tree` 时，按 host/root 的交集失效目录查询。非 Git 目录的全部变化是否同样自动更新，未在此链路证明。 | 人工扩展核对 `app-initial-6350d04672d0.js` L203119–203149 |

请求/结果结构可作为迁移契约的参考，但 SmartDD 应沿用自己的 IPC 命名和错误体系：

```ts
type DirectoryRequest = {
  hostId: string
  workspaceRoot: string
  directoryPath: string | null // Codex 此 UI 传工作区内相对目录
  includeHidden: boolean
}
type DirectoryResult = {
  workspaceRoot: string
  directoryPath: string | null
  parentPath: string | null
  entries: Array<{ path: string; type: 'directory' | 'file' }>
}
```

这里只列调用链用到的字段，不把该类型声明当作 Codex 完整公开协议；真实结果可能有更多字段。

搜索不是对当前已加载树做简单 `includes`。`qt` 调用的导入 `Bu` 对应 `app-initial` 的 `JXc`（导出映射 L225191）；由 `rZc` 管理模糊搜索会话，向后端发 `fuzzyFileSearch/sessionStart`、`sessionUpdate`、`sessionStop`，订阅 `sessionUpdated/sessionCompleted`。服务不支持 session 时回退单次 `fuzzyFileSearch`。UI 进一步按文件名分数排序，排除 `.git/.hg/.next/.pnpm-store/.svn/.turbo/.yarn/build/coverage/dist/node_modules`。普通树仍可看到 `node_modules`；不能误把搜索过滤规则应用到所有目录展示。来源：`app-initial` L210980–211190，人工静态追踪；原始客户端后端的排序算法未反编译。

## 2. 树视觉、交互与性能

E-F1/E-F2 对应 `base-file-tree-651d700763e3.js`：

| 项目 | 发布包中的值/行为 | 格式化行 |
| --- | --- | --- |
| 行高、字号 | 默认 item height 28 px，字号 override 13 px | L262、540 |
| 横向细节 | item padding x 3 px，item margin x 0，行内 gap 5 px，Git lane 20 px，level gap 0 | L267–280 |
| 目录缩进 | 覆盖 spacing-item 的 margin，减半缩进但使 guide 与完整图标中心对齐 | L282–292 |
| 长文件名 | 对 flattened item 和 middle truncate 容器设 `min-width: max-content`，在行边缘裁剪；不能统一替成省略号 | L325–330 |
| 虚拟化与粘性目录 | tree model 使用虚拟滚动容器；`stickyFolders: true`；通过 model API 选中/滚动到路径 | L368、522–532 |
| 滚动恢复 | DOM 未就绪时用 requestAnimationFrame 重试，最多 60 次；有销毁清理 | L382–394、416–430、540 |
| 右键菜单 | 根据能力装配“打开/打开方式、另存为、复制路径、添加到聊天”；外部打开不自动更改 preferred target | L72–83、438–453 |
| Git 状态 | 状态颜色用语义 token，新增/删除/修改用 20×20 mask 图标；不是文件名整体变色 | L264–270、318–350 |

树侧栏宽度按所在父容器和 UI 缩放计算，下限 200 px、上限父宽 60%；拖拽低于 collapse 判定会关闭树。来源：`review-file-tree-side-pane` L357–371、399。**这不是整个右侧工作区面板的宽度规则**，后续原型必须分别处理两层 resize。

树单击回调传 `isPreview: true`，双击传 `isPreview: false`；搜索结果也同样处理。过滤掉以 `/` 结尾的目录，不将目录当作文件打开。来源：`review-file-tree-side-pane` L113–132、228–234。

面包屑不是静态文本：有目录对应的下拉树，按同一个 directory query 查询；弹层有 loading/error/empty 三态，设置 `h-80` 和 `sideOffset: 1`。来源：`review-file-source-breadcrumb-123b3bed238e.js` L721–829。这部分是人工扩展核对，未纳入 E-F1 裁剪图。

## 3. 文件打开与标签状态

先澄清模块边界：`thread-side-panel-tab-content-e9ce64182d53.js` 的实际导出是 `ReviewThreadSidePanelTab`，主体为 Git Review diff。它不是整个文件预览区域的通用根组件。`text-file-editor-tab-content.electron-a262177660fc.js` 是短转导出入口，实际编辑器位于 `...d591818a9d3b.js`。这一判断来自 import/export 和具体调用，不是文件名猜测。

真正的打开路由在 `app-initial-6350d04672d0.js`：

1. 文件入口尝试已有标签、artifact/file viewer、文本编辑器等适配器，最终可回退 `reviewFileSource`。HTML 文件可交给浏览器预览路径，不能把 HTML 一律按普通文本打开。对应 L128647–128710、L116266–116286。
2. `vBi` 用扩展名和语言分类选编辑器：Markdown → `kind: markdown`；`.txt` → Pierre 的 `text`；识别的代码语言 → Pierre；`.wasm` 明确返回 null，未知语言可回退其他查看器。对应 L103588–103607。
3. `kha` 构建 `text-editor:${hostId}:${path}` 标签 ID，优先找到已存在的 panel；默认 target 为 `right`，同 host 同 path 不重复建标签。对应 L116438–116453。
4. 初始 state 包含 `markdownMode, markdownSourceScrollTop, pierreDraft, lineToReveal, scrollTop, textDraft`。保存的 durable route 有 version 1、hostId/path/line/column/workspaceRoot，可恢复；业务特殊回调存在时不生成通用 durable route。对应 L116440–116452。
5. 标签控制器统一管理 `openTab/activateTab/pinTab/closeTab/reorderTab/moveTabTo/updateTabState`，也管理 panel 实例、active tab、preview、unsaved、before-close 和关闭恢复。对应 L55113–55479。

临时标签规则能从控制器正文闭环：插入新 preview 时查找已有 preview 并替换其记录；打开已经固定的标签时不会降级回 preview；`pinTab` 将 isPreview 设为 false。来源 L55225–55249、55419。不能只通过标题斜体模拟 preview，而不做替换语义。

关闭/替换前支持异步 `onBeforeClose`，完成后再次检查 `contentInstance` 仍为同一个实例，防止用户切换/关闭过程中旧 Promise 误关新标签。来源 L55175–55194。跨标签文件异步读写也应做实例/版本校验。

这些 `app-initial` 内容由原始包逐函数核对；它不在 E-F1 的完整分析输入中。源码定位通过 locations JSON 单独记录。

## 4. 文档预览实际上包含编辑能力

`text-file-editor-tab-content.electron-d591818a9d3b.js`（E-F1）：Markdown 模式实例化来自 `dist-4d2b6f786eb2.js` 的编辑器 API，包括 `EditorView` 结构、State/Compartment、history、readOnly/editable 配置，并加载 Markdown 扩展；源码模式切换到 `pierre-file-editor`。库识别还有直接字符串交叉证据：该 `dist` 模块包含 `@codemirror/state` 的实例冲突错误、`CodeMirror plugin crashed` 和 `cm-editor` 样式标记，结合实例化调用符合 CodeMirror 6。精确 npm 版本与许可仍需查第三方声明，不能从文件名断言版本；Pierre 同样只确认发布包适配模块与调用，尚未确认其对应公开包的具体版本。

| 行为 | 代码证据 |
| --- | --- |
| 模式切换 | `ln.switchTo` 检查 dirty；先 await activeSave；失败或期间 mode/save handler 变化则拒绝切换。L21–39 |
| 默认视图 | Markdown 默认 `markdown`；按钮切换为 source / markdown；分别保留两种模式的 draft、scroll 和 Markdown scroll snapshot。L708–771、917–967 |
| 自动保存 | 3,000 ms；draft snapshot 500 ms。冲突、只读、无 dirty 时不 autosave。L78、440–454 |
| 手动保存/关闭 | `saveUntilClean` 配合标签 `onSave/onBeforeClose`；无法保存时弹“继续查看/丢弃”而非直接清空 draft。L788–846 |
| 外部变更 | `open-file-changed` 事件以 hostId/path 精确匹配后 `syncExternalChange`。L621–625 |
| 并发保护 | `externalSyncRevision/diskReadRevision` 丢弃过时读结果；save promise 防重入；dispose 会 abort/destroy。L145–147、218–242、304–338 |
| 较大文件 | 可编辑阈值 10 MiB；读取上限 20 MiB；超过阈值展示 readonly banner。`pierre-file-editor` L338、372；text editor L348–368、639、754 |
| Markdown 内容 | 有 frontmatter、Mermaid 渲染、选择文字加入聊天/评论、查找、跳行；需要按产品范围决定复刻次序。L78、511–679、774 |

边界使用 `>`，因此 **≤ 10 MiB 可进入编辑，> 10 MiB 且 ≤ 20 MiB 只读，> 20 MiB 拒绝该文本编辑器读取路径**；前提是文本类型检查通过。初始 draft 的实际字节数也参与只读判定。20 MiB 是读取最大值，10 MiB 是编辑阈值，两者不能合并为一个“最大文件大小”。

## 5. 文件读写、冲突与事件

`text-file-storage-2de491513fbc.js`（E-F3/E-F5）负责本地/远端请求分流：

| 路径 | 观察到的调用 |
| --- | --- |
| 普通 host 读取 | `read-file-metadata({hostId,path,contentSampleByteLimit?,contentSampleMaxFileBytes?})` → 检查 size/contentKind → `read-file({hostId,path})` → 再用实际内容字节数检查大小。L20–29 |
| 普通 host 保存 | `write-file({content,expectedMtimeMs,hostId,path})`。L31–37 |
| cloud 读取 | `fs/getMetadata` → `fs/readFile` → Base64 解码 → 检查 size；文本抽样前 4,096 bytes。L4–18 |
| cloud 保存 | metadata mtime 与 expected 对比 → write → metadata 再读，返回 saved/conflict。L32–35 |

前端 document 状态为 `ready {baseContent}` 或 `conflict {baseContent,diskContent}`。磁盘未变时保留本地编辑；磁盘等于本地内容时恢复 ready；其余情况进入冲突并展示 old/new diff。确认接受/拒绝后以当前磁盘快照为新 base，再按需保存。来源 `pierre-file-editor-5a678f752fa4.js` L322–333、`text-file-editor...d591...` L240–254、304–338。

补充主进程实际实现（以下行号均为 `release/f22-research/formatted/.vite/build/main-CqEoQDOU.js`，人工静态核对，未加入 E-F1/E-F3 裁剪图）：

| 处理器 | 主进程行为与边界 |
| --- | --- |
| `workspace-directory-entries`，L60327–60355 | 解析 host/WSL 路径后调用 `zL`；还支持 `directoriesOnly`。结果 entry 实际还包含 `name,isSymlink`。 |
| `zL/BL/GL`，L59850–59976 | 检查 root 非空且为目录；`resolve + relative` 防止词法越根；本地还检查 root 与 target 的 realpath 包含关系；remote 分支没有执行同一 realpath 检查。 |
| `VL`，L59921–59950 | 本地符号链接目录指向 root 外时不显示；remote 符号链接目录也不显示；不能推断所有符号链接文件都被屏蔽。目录优先排序，同类型 `name.localeCompare`。 |
| `read-file` / metadata，L60618–60628、61738–61759 | 通过 `getFileRequestPath` 得到路径后经 `i.di` 文件抽象读/stat/sample；sample 只有普通文件且大小不超过 sample max 时才读。 |
| `write-file`，L60629–60657 | 先 bypassCache stat；ENOENT 视为 mtime null；expected mtime 严格不等则返回 conflict；相等则 `i.di.writeFile`，再 stat 返回 saved。handler 内没有看到锁或 compare-and-write 原子操作，不能宣称原子 CAS。底层 `i.di` 未继续展开。 |
| `getFileRequestPath → MI`，L61530–61532、57769–57781 | 做路径标准化、相对路径补根；可直接返回绝对路径。**它不等于目录查询的 workspace containment 校验**，不能把目录树的校验误归给所有 read/write。是否上游另有权限约束需独立核查。 |

这套 optimistic mtime 机制可借鉴，但客户端比较不等于原子性保证。SmartDD 建议在主进程内完成项目根校验、版本检查与受控写入；文件编辑应独立实现软链接和并发策略，不能照搬路径正规化为安全边界。

## 6. SmartDD 可复刻清单与建议契约

以下是迁移设计建议，不是 Codex 现有接口的原样复制：

| 层 | 后续实现要求 | 本轮证据充分度 |
| --- | --- | --- |
| 工作区容器 | 中央仍为现有终端；右侧可关闭/调整宽度；文件内容与目录树二次分栏 | 文件树侧栏已定位；外层视觉需另做基于截图验收 |
| DirectoryService | 项目 root 注册、懒加载、缓存、abort、隐藏文件、错误/空态 | 足以设计；主进程根路径边界见本附录 §5 和 F22-A 方案 |
| SearchService | 全工作区搜索，与当前展开目录解耦；排除规则单独配置；旧请求取消 | 足以设计；后端算法未获得 |
| FileTabStore | host/project/path 身份；preview 替换、固定、关闭保护、去重、滚动状态、可恢复描述符 | 状态流已定位；持久化后端需后续开发设计 |
| FileViewerRegistry | Markdown/代码/图片/PDF/HTML 等分别路由，未知二进制显示明确 fallback | 文本和路由已定位；后续类型补查见[文件类型路由补充证据](文件类型路由补充证据.md)，Office 深度实现仍未展开 |
| EditorController | 文档 draft/base/mtime；dirty、autosave、external-change、冲突确认、最大体积 | 足以复刻主要行为；真正 IO 原子性需独立设计 |
| Visual tokens | 28px/13px、20px Git 图标位、5px gap、侧树 200px/60%、长路径裁剪、浅深 token | 已有静态参数；未完成运行时像素测量 |
| 宿主能力 | 外部打开、复制路径、另存为、加入任务上下文 | UI 能力与调用已定位；SmartDD 用现有任务/终端入口适配 |

建议先以 `projectId + dirId` 或 `taskId` 让主进程解析可信根目录并签发 rootId，后续 renderer 提交 `rootId + relativePath`；projectId 单独不足以区分一个项目的多个目录，不接受任意外部 hostId/root 组合。读取返回内容类型、字节数、mtime/revision；保存提交 expectedRevision 并返回 saved/conflict；变更事件携带根身份、规范化 path、revision。目录与标签状态按项目及目录隔离，持久化保存 dirId/taskId 和相对路径，重启重新签发 rootId，不将临时授权句柄长期复用。不要把 Codex 的账户/会话系统一并移植。

表中的 Git 标记和 Review 模块只记录源包事实；SmartDD 的 PRD 仍排除 git 相关功能，F22 不因此新增 Git 管理或状态展示。

建议先按“浏览闭环”和“编辑闭环”分别落地验收：前者完成目录、搜索、标签、Markdown/源码只读、图片/PDF/HTML路由与错误态；后者补编辑、自动保存、外部变更、冲突恢复。最新 M9 已确定完整复刻文件工作区，编辑、保存与冲突按实际参考纳入功能矩阵；浏览闭环只是中间步骤。本文记录的是此前静态调研，未执行自动保存或源码修改；AI 专有业务、LSP、跨主机传输和 Office 全功能编辑不能仅因源包中存在就自动纳入。

## 后续验收用例与未决问题

后续复刻至少覆盖：深层目录懒加载、1 万条目录项的滚动、隐藏文件、长文件名、空/不可读目录、根目录切换、跨项目同名文件、单击预览后双击固定、关闭 dirty 标签、读写期间快速切换、编辑同时外部修改、重开时恢复位置、10 MiB/20 MiB 边界、Windows 路径与大小写、浅/深主题、树和文档分别滚动、键盘焦点与菜单位置。

本轮未执行文件编辑 UI、跨平台包或性能基准；上述用例是开发验收清单，不是已通过项。目录树 keyboard handling 的第三方底层、所有文件类型的完整渲染器、源码主题与图标授权、外层面板全部动效、关闭恢复的最终持久化介质仍需后续深挖或开发前确认。本报告不能作为“已完全复刻”或“所有平台可用”的声明。
