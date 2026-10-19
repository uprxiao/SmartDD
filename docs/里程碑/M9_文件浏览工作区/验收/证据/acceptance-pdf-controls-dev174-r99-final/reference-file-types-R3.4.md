# M9 文件类型与编辑状态全集

调研日期：2026-10-17。状态：**只读逆向研究，未开发正式 App；本报告没有动态已证条目。** “全集”指下述入口、分类器和状态机的完整分支清单，不表示所有格式、第三方解析库和运行环境已验收。未知项单列，不能以静态代码替代真机结论。

## 1. 基线、来源与 REA 操作

目标为 `/Applications/ChatGPT.app`，实际 bundle ID `com.openai.codex`，`26.1007.30912` / build `20156`。复用已保存 ASAR 提取物，SHA-256 `75e397e2280dde93b70a85aa926f4282c728eacc84dfeb15ba7fb6ddd84628af`；未改目标应用，未执行目标 bundle。包内无 `.map`，本文行号是指定 hash 的格式化副本行号。

前轮证据见[文件工作区实现证据](Codex文件工作区实现证据.md)、[文件类型路由补充证据](文件类型路由补充证据.md)。本轮补齐编辑状态、全部内建 artifact 类别、Notebook 输出、扩展查看器分流、完整语言注册表及宿主实际启用的查看器操作。V1～V39 对应[本轮来源元数据](证据/m9-viewers-source.json)，含原模块 hash、ASAR offset、211 个 UTF-8 字节锚点、格式化 hash；345 条“文件名／后缀→语言 ID”映射也完整存于该 JSON，未复制实现代码。画廊与Office补查的E-V7/E-V8/E-V9及第三份独立导出详见§10。

| 编号 | Evidence ID | 操作与覆盖 |
| --- | --- | --- |
| E-V0 | `ev_c7515d2527c99fe4a700fbbf0adaa1ec53c5514b33d7a88271c116b6db549299` | 对旧子集 trace Pierre，no-match；只说明旧子集没有该模块，不说明应用缺功能 |
| E-V1 | `ev_2b1ea7ec0352084af9a92b88573add66ffba51b92c6bed2fbd11196bfd558697` | 4 个编辑模块 analyze；transport 超预算，完整结果保留 |
| E-V2 | `ev_39cfd4fe6a5ab1ac09c0f3bab1334225ca762f57cb95d645696d9b0863e16089` | Pierre outgoing trace；2 seeds / 73 nodes / 255 edges；35 observed / 493 inferred facts，complete-within-source |
| E-V3 | `ev_2d9f996b258b85025bb1ca9f545716b4879c9f3d3a5fd9ab63d97053004f3da6` | artifact 内容、loader、Notebook 共 3 模块 analyze；完整结果保留 |
| E-V4 | `ev_6b17e29051e98cd3e534d6818506449c26abe8b624c22cae6a289e1eb72b0f4c` | artifact loader outgoing trace；2 seeds / 56 nodes / 81 edges；5 observed / 160 inferred facts，complete-within-source |
| E-V5 | `ev_c89f0055b048d78e914a2c3b0b639bf6b9ff3e07b06cbf26d1a80cef424bf50b` | PDF 两个 adapter、缩略页栏、缩放常量、视频 player 共 5 模块 analyze；仅静态，完整结果保留 |
| E-V6 | `ev_fd2c4d820c71bf39f41c7aa0a9f7f97f396d8f0f4d83cbf9588a2314cf6def81` | PDF panel outgoing trace；2 seeds / 71 nodes / 190 edges；25 observed / 362 inferred facts，complete-within-source |

导出 `release/m9-research/viewers/rea-viewers-bundle.json`：367,007,587 bytes，14 records（前轮 9＋本轮 5），SHA-256 `41797485b738981cfa6bd66576ef4d67344eb3ca19b163f8dfcb0615da30469f`。ledger unknowns=0 不等于产品行为没有未知项。未覆盖旧 bundle，未 reset/close REA。原始模块与分析输入均在 ignored release 目录。

查看器补查另导出 `release/m9-research/viewers/rea-viewers-controls-bundle.json`：442,856,037 bytes，16 records，SHA-256 `9976074042de8d3498f76ed199933735f3ed7a13e7ac665212ad2c89533c87c4`。E-V5/E-V6 补充了图结构，以下界面结论仍逐一由调用方 props 与组件分支交叉核对；REA inferred facts 不冒充运行观察。

## 2. 打开入口的完整优先级

以下“静态已证”表示原包中存在已核对的条件与调用；可到达性、功能开关实际取值仍需动态验证。主入口 V1 `JG` L103766–103861；面板分派 `FVa` L128644–128699；文本 `kha` L116453–116467；artifact `Zq` L114215 起。

| ID | 分支／结果 | 条件、状态和依据 | 证据状态 |
| --- | --- | --- | --- |
| R01 | cloud HTML 特殊预览 | `Ql(hostId)`、HTML、无显式 target/workspace/preferred-target 等条件，进入 review 入口；无行列时转文本文档 HTML 沙箱。属于文件文档呈现分支，完整浏览器不在本轮范围 | 静态已证；V1 JG/TJ、前轮 E-R |
| R02 | 显式外部打开 | target 非空、openMode=workspace 或 persistPreferredTargetPath 有值，交 openIn，绕过后续默认面板分派 | 静态已证；V1 JG |
| R03 | 可选网页打开 | browserEnabled 默认 false；本地 host、HTML、无 modifiedClick 才可提前移交。这里仅记录边界，不扩展浏览器实现 | 静态已证；V1 QBi |
| R04 | 面板入口不可用／打开状态失效 | 未注册面板 handler 时外部打开；scope/替换 tab 的 contentInstance 失效时取消迟到结果 | 静态已证；V1 JG |
| R05 | 元数据辅助判定 | 本地路径、无行列且非 HTML 等条件下先 `read-file-metadata`；非文件转 fileManager，读取失败继续无 contentKind 判定 | 静态已证；V1 JG |
| R06 | 不支持的本地文件外部打开 | 本地、非 modifiedClick、无 MCP viewer、`!RBi(path,contentKind)`；fileOpenOrigin=app 或强制 fileViewer=default 等可保留面板不支持态 | 静态已证；V1 qBi/I10 |
| R07 | Office 特殊 handoff | 普通本地 pptx/xlsx、无行列／附件、无显式 viewer、有 artifactPageHandoffs 等条件尝试共享 Office 页面；失败回原面板流程 | 静态已证；V1 JG；该独立页面不等于浏览器页面 |
| R08 | 已有 tab 优先复用 | 同 host/path 的 app-file 前缀 tab 优先激活；指定行／范围／artifact target 时可能递归以 default viewer 定位。不能仅按扩展名预测新 tab | 静态已证；V1 FVa |
| R09 | 附件／artifact target 优先 | artifactNavigationTarget、isAttachmentPreview 或 chatGptFile 存在时先尝试 Zq；故同一 csv/tex 可以不同于普通源码打开；ipynb 命中 Notebook artifact，不能由此推断它也注册了源码语言 | 静态已证；V1 FVa |
| R10 | 用户指定／MCP 文件查看器 | 显式 viewer 无匹配即返回 null；否则按 preferredViewers、匹配最长后缀及内建识别结果决定。成功返回 mcpExtensionFileViewer | 静态已证；V1 CIa/SIa/Izi，L103390–103433、L126710–126729 |
| R11 | 当前工作区已有 tab 复用 | IVa 在允许的参数组合下复用已存在的文件/editor/artifact tab | 静态已证；V1 FVa/IVa |
| R12 | 文本编辑器 | `vBi` 非空、无 endLine、无 filePreviewTitle，并满足 line/tab 组合；调用 kha | 静态已证；V1 FVa/vBi |
| R13 | 通用 artifact | 无行范围且 sD 有映射时调用 Zq；durable+tex 明确拒绝；携带 environmentId/来源/附件标志 | 静态已证；V1 FVa/Zq |
| R14 | review source 兜底 | 余下进入 TJ；元数据→unsupported→尺寸→rich/source，而非把任意二进制直接当编辑文本 | 静态已证；V1 TJ；V6 L730–780 |

## 3. 全部内建类型与内容判定

V1 `Rx/Vx/Bx` L19694–19725 是源码识别器：自定义映射优先，再按完整文件名、复合后缀、末段扩展匹配，最后 text；`vBi` 再用原名／小写名查询，`.txt` 明确 text，Markdown 特判，`.wasm` 明确不进入编辑器。静态表有 **345 条映射、228 个不同语言 ID**，包括无扩展的 Makefile、Dockerfile、CMakeLists.txt、CODEOWNERS、COMMIT_EDITMSG 等。元数据保存完整表；注册语法语言不等于有编译器、运行时或全部文件均能编辑。

V2 `uTt/fTt/_Tt/vTt/ETt` L56978–57031：4096 bytes 样本供判定；SVG 先检查前 512 bytes 的 UTF-8 文本 `<svg` 或 XML+svg；再懒载 fileTypeFromBuffer；按 MIME 得到 pdf/image/audio/video/text，归档扩展得 archive，其余 binary。未知 magic 回退文本控制字符检查：空文件视 text，码点 `<32` 且不在 `7..14` 的控制字符判 binary。它不是严格 UTF-8 编码验证，也不能据此承诺 UTF-16/GBK 正确显示。

| ID | 完整类别／后缀集合 | 实际 viewer、编辑能力与限制 | 证据状态 |
| --- | --- | --- | --- |
| F01 | markdown/md/mdown/mdx/mkd | 工作区 markdown 编辑器；可切源码。文本附件分类 Oon 的 Markdown 集合只有 markdown/md/mdown/mkd，**不含 mdx** | 静态已证；V1 vBi/Oon，V2 hOr |
| F02 | txt＋345 项语言注册表命中 | Pierre 源码编辑；text 识别兜底通常交 review，不能把 registry 与允许任意二进制写入混为一谈 | 静态已证；V1 Rx/vBi |
| F03 | avif/bmp/gif/ico/jpeg/jpg/png/webp | `contentKind=image` 或扩展 fallback，二进制→MIME data URL→img；非通用图像编辑器 | 静态已证；V2 pOr，V12/V14 |
| F04 | svg | 扩展 fallback=toggle；嗅探 image 可使预览 always。img 使用 SVG data URL、白底与 padding；不把 SVG 注入 App DOM | 静态已证；V1 PBi/FBi，V14 I |
| F05 | tif/tiff | 底层图片表含扩展，但上层 LBi/UBi 明确 unsupported image | 静态已证；V1 LBi/WBi |
| F06 | pdf | artifact PDF 有 canvas/text/link annotation 层、worker、页状态与缩略页栏；review fallback 明确禁 text/annotation 层，仅 canvas 翻页。工具与注释边界见 §9 | 静态已证；V8、V18、V19；表单 renderForms=false，签名未验证 |
| F07 | tex | 源码可先命中文本编辑；显式 artifact 走 compile-latex-artifact→PDF；无结果回 TeX 源码/错误；durable 不走此 artifact 路径 | 静态已证；V1 Zq；V8 L1448、L1644–1662；编译宿主边界见主进程调研 |
| F08 | csv/tsv | 可走源码；artifact loader 用 Workbook.fromCSV(TextDecoder(...))，tsv separator=TAB，结果 spreadsheet proto | 静态已证；V7 a/o；编辑与源格式回写不能由预览能力推断 |
| F09 | xlsx/xlsm | xlsm 映射 importKind=xlsx；Walnut XlsxReader→Workbook proto，另有条件受控的 XLSX CRDT 编辑。没有证据保证宏保留或执行 | 静态已证；V1 Don/sD、V7 l、V8 co |
| F10 | docx | Walnut DocxReader→Document proto，亦有源 bytes document 路线；附件／开关影响所选路线。不可概括为所有 DOCX 都可写 | 静态已证；V7 s；V8 L1420、L2023–2027；完整写回路径未知 |
| F11 | pptx | Walnut PptxReader→Presentation proto；受开关和来源限制的演示稿编辑及 bytes+etag 保存，详见 §6 | 静态已证；V7 c；V8 Do/oa |
| F12 | ipynb | JSON NotebookPreviewPanel；code/markdown/raw，未知 cell_type 当 raw；只读，Run affordance 没有执行处理 | 静态已证；V9 he/Ee/Te；完整内容分支见下表 |
| F13 | aac/flac/m4a/mp3/mp4a/oga/ogg/opus/wav | audio preview；recognized contentKind 不足以绕过受支持后缀检查；unsupported 音频仍显示专用提示 | 静态已证；V1 zBi/HBi、V6 Ci/wi；实际 codec 支持未知 |
| F14 | mp4/ogv/webm | video preview，共用媒体呈现，自定义控制条；宿主传 maxFileBytes=128 MiB，但 local 协议 URL 路径可绕过这次 read-file-binary 查询，不能将此值概括为所有播放的统一上限 | 静态已证；V1 BBi/Qtl、V6 wi/Bi、V22；协议端限制与实际 codec/播放稳定性未知 |
| F15 | html/htm | 源码；或文本附件独立可执行文档沙箱（不是 Notebook 的禁脚本 iframe）；浏览器打开仅记录接口边界 | 静态已证；V1 JG/TJ/Oon、V13、前轮 E-R |
| F16 | doc/docx→word-document；ppt/pptx→powerpoint-deck；xls/xlsm/xlsx→excel-spreadsheet | 当上层 artifact 未接管且满足内容类别条件时，review 的 unsupported 对应文案。不能见该文案就断言整个 App 不支持 docx/pptx/xlsx | 静态已证；V1 IBi/VBi；V6 unsupported switch |
| F17 | key、numbers、pages | 分别 keynote-deck/numbers-spreadsheet/pages-document；无内建专用解析分支 | 静态已证；同上；仅限已核对默认路由，不排除扩展 viewer |
| F18 | odp/ods/odt | opendocument-presentation/spreadsheet/text 的 unsupported 状态 | 静态已证；同上 |
| F19 | rtf | rich-text-document；即便嗅探 text，rtf 仍可命中 unsupported 特判 | 静态已证；V1 IBi |
| F20 | archive | magic 归档表为 7z/Z/apk/bz2/docm/docx/epub/gz/jar/odp/ods/odt/potm/potx/ppsm/ppsx/pptm/pptx/rar/tar/tar.gz/xlsm/xlsx/xpi/xz/zip/zst；一般 unsupported，部分由 artifact 抢先接管 | 静态已证；V2 ETt，V1 FVa/IBi |
| F21 | 未支持 audio/video/image、binary、未知／无扩展 | unsupported 类型包括 archive/audio/binary/image/video 及 F16–F19；没有通用 hex editor 分支。未知 text 可以 review，外部打开行为见 R06 | 静态已证；V1 IBi/PBi；V6；未知解析库分支不外推 |
| F22 | MCP 扩展定义后缀 | 按最长复合后缀和用户偏好选择；内建列表不封闭第三方能力。资源读写有 URI 匹配与 ifMatch，outcome 可 saved/conflict/too-large | 静态已证；V1 Izi/CIa/Lzi/zzi；扩展实际注册与实现未知 |

Notebook 输出不是任意 MIME 全执行。V9 `ge/_e/ve/ke` L32–74、L244–285 的完整分支如下：

| 输入／顺序 | 结果 | 证据状态 |
| --- | --- | --- |
| stream | stdout 等名称＋文本；缺 text 则无输出 | 静态已证 |
| error | ename/evalue/traceback，可有 summary Markdown | 静态已证 |
| display_data / execute_result | 按下一行的优先级选一个呈现结果 | 静态已证 |
| image/png → image/jpeg → image/svg+xml → text/html → text/markdown → text/plain → application/json 或 application/vnd.vega.v5+json | 首个满足条件者；JSON/Vega 在这里显示格式化 JSON，不自动执行 Vega | 静态已证 |
| HTML output | iframe `sandbox=""` + srcDoc；CSP script/connect/frame/object/form-action 均 none，只允 data/blob 图片媒体、内联样式；另可查看原 HTML 文本。与可执行 HTML 文档沙箱严格区分 | 静态已证；V9 xe/G/ke |
| 其他 output_type／无识别 MIME／无效结构 | 返回空 outputs；无效 Notebook JSON/schema 显示 error；空 code/markdown/raw 有各自空态 | 静态已证；V9 ge/Ae/Ee |

## 4. 原文件、附件与历史版本的差异

| ID | 行为 | 真实条件／持久性边界 | 证据状态 |
| --- | --- | --- | --- |
| A01 | 工作区文本编辑写原文件 | V5 y 将当前 content 与 expectedMtimeMs 发给 write-file；不是“下载另存为” | 静态已证 |
| A02 | 附件优先 artifact | isAttachmentPreview/chatGptFile/导航 target 先于普通编辑器。Zq 保留 composer/sent-message 来源，已有普通文件 tab 不必被降格成附件 tab | 静态已证；V1 FVa/Zq |
| A03 | 附件下载 | V11 be 优先 onDownload，否则 workspaceFiles.downloadCopy；下载失败独立 toast；并非所有下载操作写回原文件 | 静态已证；V11 L10–29 |
| A04 | 附件编辑门槛 | V8 qe2/Ye2 要求 `!isAttachmentPreview`、无 template、写 API/开关可用；XLSX 还要求 local、workspace root、conversation 与 artifactDocuments | 静态已证；V8 L1405–1420 |
| A05 | 历史版本／库文件 | isHistoricalVersion、libraryFile、版本来源参与 props；presentation 写回还要求 libraryFile=null。不能保证任意历史预览可编辑 | 静态已证；V8 xo/Do；各来源最终可写性动态未知 |
| A06 | 文本附件 | Oon 仅 HTML/Markdown/txt 或无扩展且匹配 MIME；已有扩展未知时不会用 MIME 强制覆盖。V13 显示 Markdown/普通文本；不等于工作区编辑器 | 静态已证；V1 L43833–43856；V13 |
| A07 | cloud/durable 文本编辑 | fs/getMetadata→fs/readFile；TextDecoder；写前 metadata 严格比较→fs/writeFile→再 metadata。环境未就绪显示 Files unavailable，可 refresh | 静态已证；V5 v/y；V11 we |
| A08 | 草稿是否跨重启落盘 | 当前链仅证实 textDraft/pierreDraft 保存在 setTabState；含 CodeMirror history 函数值。未证实磁盘持久化、崩溃恢复或跨机同步 | 未知；V3 Jn L914–943 |

## 5. 文本与 Markdown 编辑状态机

基础模型是 `ready{baseContent}` 或 `conflict{baseContent,diskContent}`，另有当前编辑内容；并非自动三方合并。E-V1/E-V2 支持模块链路，以下条件逐一对照 V3/V4/V5 原包代码。

| ID | 状态／触发 | 行为及精确边界 | 证据状态 |
| --- | --- | --- | --- |
| S01 | loading→loaded/error | Markdown load 成功建立 CodeMirror；失败 didFailToLoad→loadState=error＋openError toast。Pierre failLoad→hasLoadError | 静态已证；V3 Sn.load/emitState；V4 Kn.load/failLoad |
| S02 | 读取前验证 | 本地 metadata 检查 is text/大小，再 read-file，读取后再按 Blob bytes 校验；cloud 先取 bytes，再按大小和前4096 bytes 判 text | 静态已证；V5 v L4–29 |
| S03 | 大小状态 | ≤10 MiB 可编辑；>10 且 ≤20 MiB 只读；>20 MiB 加载拒绝。Pierre 同时检查 initialDraft.content 和 savedContent 是否 >20 MiB | 静态已证；V4 L338、L372、L400–412；V3 maximumSizeBytes=20MiB |
| S04 | 普通修改 | 清 selection-edit、清保存错误、dirty=true；上报 tab 未保存状态。冲突／只读状态限制继续编辑 | 静态已证；V3 L370–382；V4 updateContent |
| S05 | Markdown 自动保存／草稿 | 保存 debounce=3000ms；草稿快照 debounce=500ms；有 undo/redo 时可保留 history，即便内容已 clean；无历史且 clean→draft=null | 静态已证；V3 L78、L439–466 |
| S06 | Pierre 自动保存／潜在修改 | 保存 debounce=3000ms；markPotentiallyDirty 立即上报 dirty，等待实际 editor change，550ms 到期解除 pending；saveUntilClean 先等 pending。草稿由 emitState/emitDraft 发出，不是 Markdown 的500ms快照 | 静态已证；V4 L372、L427–437、L498–599 |
| S07 | 保存串行 | 已有 savePromise 时等待；成功后若又修改，继续保存或重新排 autosave；内容等于 base 不写磁盘 | 静态已证；V3 L299–338；V4 L498–528 |
| S08 | 禁止自动保存 | conflict、缺 editor/document、只读且无明确 resolution 例外、无 dirty 时不启动计时；冲突等待处理 | 静态已证；V3 scheduleAutosave；V4 scheduleAutosave |
| S09 | 保存成功 | 更新 baseContent/savedContent、mtime，清 review snapshot，保持在途更新后的 dirty，不把新修改误报已存 | 静态已证；V3/V4 save |
| S10 | 保存失败 | Promise false；Markdown hasSaveError＋toast，继续保留内容；下一次编辑清错；不会因失败声称已保存 | 静态已证；V3 save；V4 save；错误类别详细映射未知 |
| S11 | mtime 冲突 | write-file 返回 conflict，重新读盘；若磁盘恰与保存内容相同可视为已存，否则进入外部变化比较 | 静态已证；V3/V4 save；V16 L60629–60657 |
| S12 | 外部变更事件 | open-file-changed 按 host/path 过滤；未加载标 pending；revision/abort 防止迟到读取覆盖新状态 | 静态已证；V3 L218–244、L617–625；V4 syncExternalChange |
| S13 | 干净 Markdown 外改 | local==原base 且生成 conflict 时自动 accept 磁盘内容；同步后继续快照/状态处理 | 静态已证；V3 L237–244 |
| S14 | 干净 Pierre 外改 | 仅 reloadCleanExternalChanges=true 时直接重载；否则仍可进入 review。不能无条件承诺所有源码外改自动刷新 | 静态已证；V4 L533–542；调用场景实际开关待动态核对 |
| S15 | 脏内容外改 | 保留 local 与 disk，暂停 save，显示 inline diff review；accept/reject 意义依 old/new 方向变化，见下表 | 静态已证；V4 An/jn/Mn；V3 applyDiskSnapshot |
| S16 | 解决冲突后只读 | 根据结果内容 bytes 再算只读；保留 maySaveReadOnlyReviewResolution，允许特定明确 resolution 写回，不等于开放大文件自由编辑 | 静态已证；V3 L246–254；V4 resolveExternalChange |
| S17 | Markdown↔源码切换 | mode manager 只记录当前 mode 的 save/dirty；有 dirty 先 await activeSave；保存失败或 activeMode/activeSave 在等待中改变则取消切换 | 静态已证；V3 un L19–40、Nn |
| S18 | 关闭 clean/dirty | clean 直接通过；dirty 先 saveUntilClean；失败弹 Continue viewing / Discard changes。取消保留；确认 discard 才清 draft 并销毁。校验 tab/path/host/onBeforeClose 引用防止误关新 tab | 静态已证；V3 Bn/Un L782–843 |
| S19 | 卸载/pagehide | dispose 默认 flush草稿/滚动、尝试saveUntilClean后销毁；discard 模式直接清草稿；异步浏览器退出时保存是否完成未实测 | 静态已证＋退出完成性未知；V3 L145–148、L481–483；V4 dispose |
| S20 | 恢复草稿 | Markdown initialDraft clean 或可被磁盘替换时取磁盘；dirty 用 base/disk/local 重建 conflict；history 仅内容一致时恢复。Pierre content/savedContent 分开恢复并核对磁盘 | 静态已证；V3 getInitialDraft/load；V4 load |
| S21 | 行尾保留 | Markdown 未实质变更返回原base；修改后按原base是否含 CRLF/CR 恢复行尾；不代表 BOM/全部编码原样保留 | 静态已证；V3 getContentWithLineEndings L160 起；编码完整性未知 |
| S22 | 选择文本/AI edit | pending/review/failed/canceled；只在ready、非只读生效；内容改变／退出取消；小改动≤4000 code units 且各≤40行可 inline，否则全区review；这是 Codex 交互事实，不自动成为 SmartDD AI 能力需求 | 静态已证；V3 fn/requestSelectionEdit、V4 Pn/Fn |
| S23 | 撤销/重做/滚动 | CodeMirror history、canUndo/canRedo；内容匹配才恢复 scrollSnapshot，否则 scrollTop/line reveal；源码另存 markdownSourceScrollTop | 静态已证；V3 load/Jn，V4 footer |

外部变化判定与 review 含义（B=原base、D=磁盘、L=当前local）：

| 条件 | document／review | accept / reject 的内容结果 | 证据状态 |
| --- | --- | --- | --- |
| D=B | ready(base=B) | 不产生新外改冲突；L≠B仍是本地dirty | 静态已证；V4 An |
| D≠B 且 L=D | ready(base=D) | 磁盘与本地已一致，不冲突 | 静态已证；V4 An |
| D≠B 且 L=B | conflict；old=L，new=D | accept取D；reject取L，此时可能把外部修改恢复为原内容 | 静态已证；V4 jn/Mn；Markdown clean分支会自动accept |
| D≠B 且 L≠D 且 L≠B | conflict；old=D，new=L | accept保留本地L，reject取磁盘D；二者均把base设D，edit取new后继续编辑 | 静态已证；V4 jn/Mn |

不能将按钮永久翻译成“接受外部版本／丢弃外部版本”，也不能宣称会逐行自动合并。SmartDD 的文案应明确“保留我的修改／使用磁盘版本”等用户结果，属于设计选择，须与原型确认。

## 6. Office 保存不是文本保存的复用

| ID | 路线／完整状态 | 行为与边界 | 证据状态 |
| --- | --- | --- | --- |
| O01 | 文本本地 mtime | stat(bypassCache)→expectedMtime严格比较→write→stat；ENOENT 按 mtime=null。可见 handler 没有原子 CAS，不能证明竞争窗口被消除 | 静态已证；V16 L60629–60657；底层原子性未知 |
| O02 | 演示稿 bytes+etag | oa debounce=500ms；首次readBaseline必须 matchesSource 且etag非空；write(bytes,ifMatch)须saved且新etag；排队串行；失败冻结本次dirty并toast，下一schedule可再试 | 静态已证；V8 L93–129、L1949–1966、L2199 |
| O03 | PPTX 编辑开关 | source bytes可用、非库文件、有read/write；presentationEditingEnabled 决定isEditing，注释保存还可独立激活。关闭前 flushEdits＋保存队列，失败阻止关闭 | 静态已证；V8 Do L1926–1968、L2028–2036 |
| O04 | XLSX 适用条件 | artifactDocuments 存在、local、xlsx、非附件、无template、workspace/conversation齐全；不是xlsm宏编辑保证 | 静态已证；V8 L1410–1412 |
| O05 | XLSX 会话状态 | starting/live/refreshing/blocked/fallback；problem 可 conflict/persistence/unsupported/too-large；worker失败可回静态preview。状态与问题字段分离 | 静态已证；V8 co/so L586–1245 |
| O06 | XLSX 更新/落盘 | onCrdtUpdate 收集 baseStateVersion/updateId/originId，appendQueue→append→materialize；500ms materialization debounce、1000ms retry；stateVersion与materializedStateVersion分开 | 静态已证；V8 L590–598、L1083–1227 |
| O07 | XLSX 外部修改/刷新 | publicFile bytes/hash、localMutationVersion、pending CRDT drain共同判断；干净时停旧editor并刷新，脏内容或版本不同保留conflict；不直接覆盖磁盘 | 静态已证；V8 reconcileExternalPublicFile/refreshCleanSession/quiesceLiveEditorForRefresh |
| O08 | XLSX 保存异常/关闭 | append/subscription/materialize失败进入problem与必要retry；materialize分stale/too-large/conflict/success；dispose先尝试排空drain/queue/materialize，hardDispose另行清理 | 静态已证；V8 L721–740、L1088–1195；底层artifactDocuments持久化完整性未知 |
| O09 | DOCX/Office解析依赖 | Walnut loader配置.NET/WASM并getAssemblyExports，Docx/Pptx/Xlsx Extract*Proto；不能把这套专有解析链当作 SmartDD 已拥有的可复制源码 | 静态已证；V7/V15；替代库兼容度、许可、字体、宏和复杂布局未知 |
| O10 | MCP 资源写回 | resource URI匹配，text/blob→bytes，ifMatch；saved/conflict/too-large；这条资源契约与文本mtime、PPTX bytes+etag、XLSX CRDT分别核对 | 静态已证；V1 zzi/Pzi；宿主执行边界由主进程调研补齐 |

## 7. 尺寸、错误、状态图标与可操作界面

不同路径的上限不能合并为一个“最大文件大小”。MiB 按1024² bytes；code units 按 JS `.length`。

| ID | 检查／状态 | 已核对常量或UI | 证据状态 |
| --- | --- | --- | --- |
| B01 | 文本 | ≤10MiB edit；(10,20]MiB只读；>20MiB拒绝；读取后复查 | 静态已证；V3–V5 |
| B02 | review source | `sizeBytes > 268435456` 才 tooLarge，等于256MiB通过该前置检查；unsupported先于size判断 | 静态已证；V2 Cht；V6 L760–774 |
| B03 | audio/video | renderer传 `maxFileBytes=268435456/2=128MiB`；播放codec与后端真正执行该上限尚需核对 | 静态已证；V6 wi/Bi；后端执行未知 |
| B04 | 非PDF artifact | `sizeBytes > 41943040` 拦截，等于40MiB允许；读binary带maxBytes；metadata未知size时仍依赖读取检查 | 静态已证；V8 L1438–1448、L1639 |
| B05 | PDF/TeX artifact | 本层绕过非PDF40MiB gate，PDF binary请求不带maxBytes；不等于无限大，须结合主进程限制 | 静态已证；V8 L1438–1448；后端限制见主进程调研 |
| B06 | 文本HTML附件 | cloud UTF-8 >10MiB拒绝；<=5,000,000 UTF-16 code units 才HTML呈现，超过显示文本；自定义loadText分支不能泛化字节检查 | 静态已证；V13；前轮E-R |
| B07 | inline diff | 任一内容 >262144 UTF-16 code units 或 >5000行，不绘制diff但保留可用操作按钮；等于边界允许 | 静态已证；V10 O/j/L |
| U01 | 文件加载/错误/空态 | Loading file；Unable to load file；Open file/Select a file from workspace tree；non-file/read错误不伪装空文件；unsupported有15种专用文案 | 静态已证；V6 yi/li/Pi/Ni及unsupported switch |
| U02 | 保存状态浮层 | `absolute right-4 bottom-4 z-10`；无undo/redo/saving/error且无vimMode则隐藏；Saving显示spinner；Save failed用danger文本。Redo复用Undo图标水平镜像 | 静态已证；V4 _n L172–203 |
| U03 | 已定位图标资源 | Undo `arrow-uturn-left-light-16`（V2 Amt）；save failed新asset `circle-info-light-16`（V2 bC），同时保留legacy fallback；未实测实际icon rollout取值 | 静态已证；V2 L104076、L137836；像素一致性未知 |
| U04 | 冲突操作 | Edit/Reject/Accept三个文字按钮；Edit/Accept各有disabled条件；Reject danger、Accept chart-green；换行按钮以wrap状态切asset | 静态已证；V10 A L47–72；最终中文文案/hover截图未知 |
| U05 | 关闭失败对话框 | Discard file changes?；Continue viewing；Discard changes；描述会丢失未存修改，确认才dispose(discard) | 静态已证；V3 Bn/Un |
| U06 | Notebook | code cell Run图形是span，hover/focus才显，tooltip“Running is disabled in read-only preview”；有代码折叠、cell空态、error输出、HTML源码折叠 | 静态已证；V9 Te/Oe/Ee/ke；图标实际形状尚待截图 |
| U07 | viewer菜单 | word wrap、rich view、git blame、copy path、copy file contents；可用性依内容/行定位/feature flag，不应全量固定显示 | 静态已证；V6 bi L831–918 |
| U08 | 运行状态与静态默认差异 | 实际菜单是否出现、feature flag、深浅色、字形、hover/disabled、各文件codec结果 | 未知；需隔离fixtures动态观察，不能用bundle存在替代 |

## 8. 文件内查找、跳行、LSP 与只读来源信息

V17 为 `review-file-source-breadcrumb-123b3bed238e.js`，模块前半部实际承载跳行和语义导航，不应由文件名误判其只有路径导航。该完整模块已在 E-F1 `ev_55b47eb3b7d655b1b283aa58cb63e6f09ef003fc94e7392f92d84e78cb0a1ed0` 输入中，本轮复用证据逐分支核对，不重复全量 REA；新增源锚点存入 V17。全文跨文件搜索、普通树 generated 过滤与 Git 装饰见[目录搜索全集](M9_目录搜索与视觉交互全集.md)。以下均为静态已证，运行效果未验证。

| ID | 条目 | 实际条件、参数与状态 | 证据状态／定位 |
| --- | --- | --- | --- |
| C01 | 文件内查找 | Markdown 内容控件有 Find in file、previous/next、noResults、结果计数、close；与跨工作区 Find in files 不同 | 静态已证；V3 L511–579 |
| C02 | 跳行语法 | `rt` trim 后匹配 `^-?\\d+$`；非安全整数和0无效；有行数时负数从尾部计，结果夹到1…lineCount；空文本行数1 | 静态已证；V17 L9–28 |
| C03 | 跳行预览与取消 | 输入变化可临时预览；Enter提交，Esc/关闭可取消并恢复原selection/scroll；范围与aria-invalid错误分别呈现；焦点按所属panel/Shadow DOM判定 | 静态已证；V17 st/ut/dt L29–286；V3 L174–204 |
| C04 | LSP能力门控 | flag `1932174607` 且 active；宿主`lsp.capabilities({hostId,languageId,path,workspaceRoot})`；返回hover/locationKinds，5秒stale；无宿主不能推断语言服务器可用 | 静态已证；V17 Ft/cn/ln L358–366、L564–620 |
| C05 | Hover | 初次300ms；移开关闭延迟100ms；内容hash/requestVersion/position进入query key；null且能力允许才每500ms重试，最多2次；contents变化清旧状态 | 静态已证；V17 bt/xt/Ft/mn L301–366、L636–697 |
| C06 | 位置查询 | `lsp.locations({...languageFile,kind,position})`；kind为definition/typeDefinition/implementation/references；0个不跳、1个直接跳、多项列表；旧Symbol request结果丢弃 | 静态已证；V17 Dt/It L340–378 |
| C07 | 列表与坐标 | 首批100，Load more每次加100；显示path、line+1、character+1；点击用原0基range导航；signature代码与documentation restricted Markdown分开呈现 | 静态已证；V17 Wt/Yt/Xt L399–478 |
| C08 | 键鼠与历史 | Ctrl/Meta+token click仅definition能力下；file.goToDefinition/file.navigateBack/file.navigateForward按active、panel、surface焦点限制；历史去重path+position，返回后新跳转截断前进栈 | 静态已证；V17 mt/ht/nn/ln L281–300、L488–620 |
| C09 | 只读blame | toggle启用且cwd可用时查询`blame-file`，5秒stale；只有success结果按lineNumber建map；gutter显示作者，弹层作者/日期/commit及可选PR链接 | 静态已证；V6 L18–114、L987–1014；后端Git数据来源与错误文案另需集成验证 |
| C10 | blame视觉与链接 | gutter宽10ch；tooltip宽32ch、max42vw；hover/focus/展开可见；链接阻止冒泡并交onOpenBlameLink，不执行Git提交或分支操作 | 静态已证；V6 L75–114、L494–660 |

本轮最新 M9 纯文件范围已包含只读 Git 状态/blame/generated、MCP viewer、LSP及选择编辑的适配设计与用例。它们是需实现的文件能力边界；现有 Skill/MCP配置注入不能当作已经具有 viewer 或语言服务。原型可用 mock 表达状态，真实 provider/模型/解析器仍须分别完成；Git提交、分支、合并管理和完整浏览器不因此加入。

## 9. 查看器真实工具栏、上下文与键盘分支

本节严格区分宿主启用的能力、组件可选但本路由未传入的能力和原生运行未知。V18=`pdf-preview-panel`，V19=`pdf-preview-diff`，V20=`paged-thumbnail-rail-layout`，V21=`artifact-preview-zoom`，V22=`player-5984…`，V23 为 `player-2279…` 的静态重导出桥。没有据 PDF.js、HTMLMediaElement 或通用菜单库的能力推断产品已有相应按钮。

| ID | 实际路由／操作 | 宿主条件、可见控件与行为 | 状态／精确依据 |
| --- | --- | --- | --- |
| D01 | artifact PDF 宿主 | V8 PDF 分支传 initialPage、onPageChange、onDownload、annotationsEnabled、annotationBatchingEnabled；不传 requestEditsEnabled 或 onSourceClick。前者默认 false，后者为空，所以不能把别的宿主 TeX 源码定位功能算作普通 PDF 能力 | 静态已证；V8 L1644–1705；V18 jn L608–619 |
| D02 | PDF 顶部工具栏 | 标题／共用文件菜单、独立下载控件、Zoom 菜单、条件注释按钮；controls 中 editingControls/commentsControl/navigationControl 明确为 null。没有本 adapter 的搜索、旋转、打印、页码输入框或独立加减缩放按钮；hook 返回 increase/decrease 不等于宿主启用按钮 | 静态已证；V18 Pn L881–899、qt L314–361；全局 OS 菜单能力仍未知 |
| D03 | PDF 缩放菜单 | 实际传入预设25/50/100/150/200%，另有 Zoom to fit；菜单项有 aria-current/check，align=end、sideOffset=4，无任意百分比输入框。PDF percentage clamp 为30%–800%，因此选择25%会落到30%且25项不勾选，须作为参考差异记录；Fit 按可用宽度且不放大超过100% | 静态已证；V21 常量；V2 sUi/fUi L139243–139310；V18 Y/Yt/dn L366–404 |
| D04 | PDF 滚轮与缩放状态 | 仅 ctrlKey 滚轮阻止默认并缩放；deltaY夹±20、指数系数0.005、2%邻近档位吸附；120ms结束zoom状态、200ms清累计值，保留鼠标锚点。未证实 Cmd +/- 等快捷键由该宿主注册 | 静态已证；V18 qt/Qt/dn L314–404 |
| D05 | PDF 缩略页导航 | 只有多页显示栏；hover/focus展开，离开且未dock则收起；dock/undock；页数和每页缩略图按钮，当前页 aria-current=page。点缩略页平滑滚动；滚动用 IntersectionObserver 跟踪最可见页，初始页夹到1…总数并回写 onPageChange | 静态已证；V20 x/C/w/M L4–209；V18 L904–914；非页码输入器 |
| D06 | PDF 文本与原文链接 | TextLayer 可选择文本；AnnotationLayer 仅呈现原 PDF annotation/link，renderForms=false，annotationEditorUIManager/commentManager/storage未传；内部destination跳页，外链target=_blank并带noopener/noreferrer/nofollow。linkService rotation恒0、setter为空；namedAction/setHash不处理 | 静态已证；V18 bt/xt L29–133、Ht L276–307；外链最终主进程策略另行验收 |
| D07 | PDF 评论／请求修改 | feature3979058447的annotations_enabled默认true，annotation_batching_enabled默认false；运行取值未知。支持选中文字或区域关联评论上下文；直接提交可发pdf-direct-comment，batch/request模式排队。它是任务请求／评论，不是向PDF写入墨迹、表单、签名；Escape退出评论模式受活动草稿保护 | 静态已证；V8 L1402；V18 Et L141–210、Pn L640–873；真实任务桥接未知 |
| D08 | PDF 加载失败与重试 | 页面渲染失败显示独立错误／重试；重试更新request key；旧任务不应回写新文档。PDF有惰性接近视口渲染与canvas/text/link分层，不以空canvas充当成功 | 静态已证；V18 hn L413–514、jn L608–619、Pn L918–926；字体/加密运行能力未知 |
| D09 | review PDF 另一条路线 | 按容器宽度渲染单页canvas，明确renderTextLayer=false、renderAnnotationLayer=false；多页才有prev/next和当前/总数，首尾禁用；pager悬停/焦点显示。无上述artifact缩略页、文本选取或评论工具 | 静态已证；V19 ln/pn/yn L880–960；不能混成统一PDF控件表 |
| D10 | 普通树图片／SVG | V6 Ci 的imagePreview传入V14 Oe/I，主体只是max-h/full max-w/full object-contain img；SVG data URL有白底padding。组件无专用放大、旋转、适应按钮、点击画廊或自定义onContextMenu。文件共用打开/另存等菜单见§7；原生右键实际策略未知 | 静态已证；V6 L920–955；V14 Oe/I L7–36 |
| D11 | Markdown 嵌入图是另一路 | V1 Qtl→$tl→tnl有cursor-zoom-in点击进入图片预览、相邻图导航与下载回调；图片上下文菜单只在scope非other或ChatGPT上下文存在时传入lazy provider。不能把此画廊能力移植描述为普通树图片已经启用；实际菜单、两种灯箱及分支已补查见§10 | 静态已证；V1 L217038–217194；V24→V25与V26→V27 |
| D12 | 音频可见卡片 | 自定义文件名／格式、loading/unavailable、play/pause、m:ss当前/总时长、range seek(step0.1)。duration非正则seek禁用；audio元素虽有controls=true但class=hidden，用户看到的是自定义卡片；此组件未提供音量、倍速、loop按钮 | 静态已证；V1 wtl/jtl/Mtl L216801–216910 |
| D13 | 音频菜单／保存 | 更多菜单Copy path（sourcePath非data URI）与Save a copy（src存在）；data URI提取base64，否则read-file-binary，再save-file(kind=contents)，文件名非法字符替换下划线；失败独立toast。没有该组件自定义右键或快捷键矩阵，按钮/range标准键盘交互需运行验收 | 静态已证；V1 Ttl/Ntl L216855–216920；实际复制/保存未执行 |
| D14 | 媒体资源路径与释放 | 宿主wi传allowWide、scrollable、container和128MiB；Qtl本地绝对媒体路径可生成IIe协议URL并关闭binary查询，否则maxBytes传入read-file-binary。data URI转BlobURL，卸载清src/load并revoke；媒体query gcTime=0。协议端大小限制不能由前端128MiB推出 | 静态已证；V6 wi L956–967；V1 btl L216766、Qtl L217038–217048；协议端限额未知 |
| D15 | 文件视频可见控件 | Qtl通过V23到V22 O；宿主传sizing=container、onSaveCopy，不传presentation/onExpand/sourceUrl，故presentation=below。video无controls prop；显示自定义play/pause、seek(step0.1)、进度、音量、options、条件fullscreen；不使用原生浏览器控制条 | 静态已证；V1 Qtl；V22 O L10–242；V23重导出 |
| D16 | 视频键盘／拖动 | 聚焦video时Space与Enter防默认且忽略repeat，当前宿主均切换play/pause；seek拖动先暂停，pointerup/cancel/lostcapture按拖前状态恢复。ArrowLeft/Right ±5s与2500ms自动隐藏只属于overlay分支，普通文件below宿主未选择它 | 静态已证；V22 O L25–83、L116–136；默认slider键盘增量须运行验证 |
| D17 | 视频音量／菜单 | volume弹层：mute toggle、0…1 range(step0.01)，调音量会unmute；options有Save video as与0.25/0.5/0.75/1/1.25/1.5/1.75/2速率；Copy link依sourceUrl而当前宿主没传。PiP依document.pictureInPictureEnabled且非overlay，fullscreen依allowFullscreen(defaulttrue)与document.fullscreenEnabled；失败显示actionFailed状态 | 静态已证；V22 O L145–242；系统能力与codec未知 |
| D18 | Notebook 顶部与cell折叠 | 默认标题来自metadata或去.ipynb文件名，cell计数、下载；renderHeader获annotation/comments/editing/navigation/zoom均null。每个cell外层details默认open=true；Code 内层 disclosure 由非空 descriptionMarkdown 控制：trim 后非空才默认折叠；缺失/空白描述直接显示源码，与 outputs 是否存在独立（R2 勘误）。Run N仅execution_count标签，Run affordance为不可操作span | 静态已证；V9 Se/we/Te/Ee/Oe L130–239 |
| D19 | Notebook 代码复制与输出 | code/raw引用V2 Mqi，默认showActionBar/showCopyButton=true，复制的是完整source；shouldWrapCode=true，但没传onToggleWrapCode所以无wrap切换按钮。输出raw/details另行展开，image限高640px，HTML iframe高h-72；没有Notebook专用运行、编辑、缩放、查找或右键处理 | 静态已证；V9 Ee/Oe/ke/q/J L200–324；V2 Mqi L140454–140530；原生选择／快捷键实际行为未知 |

原型若显示统一的PDF页码输入／旋转／打印、图片缩放控制或native视频controls，应明确标成模拟差异，不能据此宣布已细粒度复刻。新增功能并非禁止，但需有独立产品决策。对上述“无按钮”的结论仅限定所核对宿主与adapter，不证明OS菜单、其它入口或未读取扩展没有相同功能。下载、任务评论与外链分别对接批准的主进程／任务桥；不得直接复制Codex专有实现或私有协议。

## 10. Markdown 图像画廊与 Office 宿主的补充核对

本轮沿用同一已保存发布包，未运行或改动目标应用。E-V7 为九个相关原始模块的聚焦 `analyze_javascript_application`，Evidence `ev_fdcba5064bef76928a9dadc5474f2f7fa644c54267b14e9197f911300dddf4da`；结果因传输体积超限留存在 REA。E-V8 从实际菜单模块向外 trace，Evidence `ev_1a0dc13ab2938df3251be721b94504ae6bd0064a1612d6384e5dbcd9aff994a9`，2个种子、23节点、97边、11 observed/186 inferred facts。E-V9 从 presentation panel 向外 trace，Evidence `ev_d4b486133e7d83a8815eaf57763287e1d75927ead8e517e515fd394015baa828`，2个种子、60节点、538边、6 observed/1073 inferred facts。两条 trace 均声明 **partial source graph**；可达边不是运行证明，图中 unknown=0 也不表示产品没有未知项。下表同时逐项回查了完整原始模块、静态重导出和宿主传参；新增键盘/图像辅助模块只读定位，不重复全量分析。

V24/25 为 `generated-image-context-menu-36…` 桥及 `30e…` 实现；V26/27 为 `chatgpt-image-lightbox-eab…` 桥及 `55a…` 实现；V28 为剪贴板 helper，V29 为 overlay；V30/31 分别为旧 DOCX adapter 与 Popcorn 文档 panel；V32/33 为 presentation panel 与宿主 bridge；V34/35 为 workbook 桥与实现；V36 为交互键盘 guards，V37 为共享浮动工具栏／快捷键分类 helper，V38/39 为 local image panel 与 image side panel。完整文件名、原始 SHA/ASAR offset、格式化 SHA/行号和原始字节锚点见同目录 `证据/m9-viewers-source.json`。以下事实均为**静态已证；动态未执行**。

### 10.1 Markdown 图片的菜单与两种灯箱

| ID | 操作／状态 | 已确认的产品分支与限制 | 定位 |
| --- | --- | --- | --- |
| G01 | lazy provider 的实际顺序 | Open image in new tab → 条件 Copy image address → 条件 Add to chat → 条件 Copy image → 条件 Open in file manager → Download a copy；该 provider 没有裁剪、旋转、删除原文件项 | V24桥；V25 Se L5–73 |
| G02 | 新标签 | 解析本机/远端asset后交打开器，明确 `openInEditor:true, readOnly:true`；失败toast。新标签是图像查看路由，不代表原始图片已可编辑 | V25 L7–18 |
| G03 | 复制地址与本机定位 | address只取src/displaySrc中第一个可解析HTTP(S)地址；file-manager仅绝对文件路径、本机host且id匹配时出现，跨host/HTTP/data不提供这一项 | V25 L20–24、L55–61 |
| G04 | 加入聊天 | capability.canSelect才有；onAddToChat返回false可阻止；模型明确不支持image输入则报错；上传/附件失败撤回pending状态。迁移只对接已有获授权任务输入能力，不等同自动发送消息 | V25 L26–51、we L81–164 |
| G05 | 复制图片 | capability.canCopy且ClipboardItem/navigator.clipboard.write存在才出现；helper把非PNG图解码到canvas并转PNG再写ClipboardItem。不是复制原始文件格式；拒绝/解码失败须反馈 | V25 L52–57；V28 c L7–32 |
| G06 | 动画与下载 | capability由isAnimated或image/gif MIME判定：动画禁canEdit/canSelect/canCopy；下载扩展可固定gif。菜单调用只传isAnimated，不应额外声称它对任意URL内容自动鉴别GIF；下载始终有，优先宿主onDownload，否则解析资源并另存 | V1 mcl L219518–219520；V25 L6、L62–73 |
| G07 | gallery集合 | 只收当前DOM仍connected的注册图片，按compareDocumentPosition排序，取currentSrc优先；selected未注册则退为单图。前/后首尾不循环；打开时选中当前图 | V1 rnl L217184–217186、tnl L217109–217169 |
| G08 | 直接旧灯箱 | tnl→xel：关闭、下载、前/后、底部缩小／百分比／放大；caption来自alt。Markdown调用不传editButton/自定义编辑工具；通用组件接收editButton不等于本路径显示编辑 | V1 xel L216358–216567；tnl L217169 |
| G09 | 旧缩放与触控 | Fit按图像/可视区且最多100%；步进档25/33/50/67/75/80/90/100/110/125/150/175/200/250/300/400/500，额外插入当前Fit值；ctrl+wheel指数缩放并保持指针锚点，line/page delta分别乘16/800；单指平移、双指缩放；换图清手势并回Fit | V1 Cel/Tel/Del/xel L216358–216619；V2 L56353 |
| G10 | 旧键盘与焦点 | ArrowLeft/Right无修饰键、非IME/defaultPrevented且目标不是输入/textarea/contenteditable/menu/slider/grid/tree等才换图；close-auto-focus回调恢复来源。组件订阅step-zoom/reset-zoom消息，但本层不能证明全局Cmd +/-的绑定 | V1 xel L216479–216541；y9r L88516–88520 |
| G11 | 新 overlay 入口 | Zel要求local/chatgpt scope、`!G(Qp)`，且config2983946247.image_overlay_enabled=true（默认false）；然后lazy加载V26→V27→V29。V27再次检查portal和flag，不满足时退通用旧xel，且该退路显式showDownload=false；不同于G08直接旧灯箱默认下载 | V1 Zel/Qel L216707–216730；V27 w L8–13、L72–77 |
| G12 | 新 overlay 可见控件 | 标题、保存、关闭、缩放、前/后、current of total；失败可回退thumbnail、均失败有Try again。Markdown Qel不传favorites且attribution/destinationUrl=null，因此不能凭通用lightbox列出收藏或来源外链 | V1 Qel L216721–216722；V27 L26–77；V29 qe L11–232 |
| G13 | 新 overlay 只读约束 | V27明确readOnly:true、no-referrer；V29据此不挂composer；V39 `!St2`门控编辑/评论/擦除/背景移除/resize工具。仍有下载和导航，不能把只读解释为所有交互禁用；实际zoom/pan来自嵌套图像viewport，未逐个复核其所有全局快捷键 | V27 L64；V29 L12；V38 L429–432；V39 L1170–1212、L1390–1412 |

上述菜单和灯箱仅对Markdown嵌图/明确图像查看入口成立。普通文件树图片仍遵守D10。原型中没有真实Clipboard/asset/任务输入能力时，必须显示示例状态，不以模拟toast代替系统效果。

### 10.2 DOCX：HTML adapter 与专有文档 panel

| ID | 操作／状态 | 已确认的宿主与包装层事实 | 定位 |
| --- | --- | --- | --- |
| O11 | 两条分发 | V8 `ct2 = docx && (isAttachmentPreview || !Pe2 || !He2)`选旧docx-preview；否则走Popcorn document。Pe2/He2来自上层可用性和feature条件，不能将所有docx统一为一种工具栏 | V8 L1418、L1706–1772、L2021–2027 |
| O12 | 旧adapter顶部 | 共用标题/文件菜单、下载、缩放菜单/Fit、条件Request edits/注释；editingControls/commentsControl/navigationControl均null，无专属搜索、打印、旋转、页码输入。分页是独立缩略栏（多页、hover/focus展开、dock），不是header页码 | V30 en L195–345；V20 x/C/w/M |
| O13 | redlines | 仅检测hasRedlines且flag1292007209允许时展示Show/Hide redlines，默认显示；切换保护未完成注释草稿并同步滚动/清选区。展示原文插入删除的两种视图，不是接受/拒绝修订后保存DOCX | V30 L196、L223–224、L307–335、L646 |
| O14 | Popcorn宿主启用项 | V8明确enablePageNavigation=false，注入标题、共用header及Zoom/Fit；未传isEditing/artifactSearchEnabled/annotationsEnabled。外包装nm默认三者false，所以不能套用内部Gp/rp更宽的默认值；无编辑格式栏、查找栏、绘图/评论和header页码 | V8 L2024–2027；V31 nm L5137–5160、Gp L5079–5104 |
| O15 | 文档呈现与能力界线 | rp把isEditing传controller.setEditingEnabled；renderer/worker可呈现页面与对象。该宿主的只读呈现不证明DOCX原文件写回；可选择内容、复制格式精度、完整按键表和复杂页布局仍需在实际worker运行验证 | V31 rp L4570–4574、worker初始化L3996；既有O01–O03持久化研究 |

### 10.3 PPTX：缩略页、网格、备注和条件编辑

| ID | 操作／状态 | 已确认的宿主与包装层事实 | 定位 |
| --- | --- | --- | --- |
| O21 | 宿主能力 | `ot2`要求presentation、手动编辑或评论场景、sourceBytes存在、非libraryFile、workspaceFiles.read/write；真正isEditing=`_e2 && ot2`。注释另看feature/commentThreads且排除template；不是“能预览就能写” | V8 L1966、L2029–2045；V33 controller桥 |
| O22 | 页导航分开 | enablePageNavigation=false关闭header pager，不删除slide sidebar、thumbnail或grid；缩略图栏受宽度和view mode影响，可展开/收起；grid与单页切换仍可用，notes在编辑或有非空内容时显示，非编辑textarea只读 | V32 lm L3916–4111；notes L953–985；header L1009–1024 |
| O23 | 已有缩放快捷键 | Shift+1适应；单独Meta或Ctrl+0实际大小；Meta/Ctrl加号/减号每次0.1步进并clamp。排除输入/embedded content/IME/repeat；主修饰键必须恰好一个，不能Meta与Ctrl同按；按键语义不同于通用“Fit”埋点名字 | V32 ip L2497–2509；V36 n/r L17–37 |
| O24 | Grid快捷键 | 恰好一个Meta/Ctrl+Alt+1，不能Shift/IME/repeat，目标不能是输入且不能正在文本编辑；切grid/slide并恢复相应焦点。只读模式不是一概禁导航快捷键 | V32 lm中Yn2 L4051–4074 |
| O25 | 编辑时的插入／格式UI | isEditing与能力允许后出现Add slide、Insert text、image、chart、table、shape与Format pane；图像生成还需生成provider。JS可见字体/字号/加粗斜体下划线删除线、段落/列表、填充/透明度、边框/阴影、排列、图片替换、表格首行/列样式、图表类型/图例/坐标等分支；各项依当前选区类型/配置，并非无条件全部显示 | V32 lm L4075–4111、adapter/format配置L5586–6600；V33宿主 |
| O26 | 两种右键 | slide菜单Duplicate、Show/Hide、Delete（canDelete控制最后项）；element菜单Bring to front/forward、Send backward/back，prepareMenu失败则空。菜单显示CmdOrCtrl+Shift+F/B与Alt+Shift+F/B加速键文本；仅此不能证明全局按键已绑定 | V32 D_/k_ L5568–5583 |
| O27 | 编辑键盘guard | tableEditing条件下箭头/Tab移动、Shift扩选（非Tab）、主修饰+A全选、Delete清、Enter/F2激活文字；Escape取消当前手势/编辑状态；`/`、ContextMenu、Shift+F10只在相应编辑选区及无输入冲突时请求工具/菜单。外层wrapper默认artifactSearchEnabled=false，不能凭公共组件把查找列为已启用 | V32 _p L2604–2624、stage L3424–3535、v_ L5431；V36 |

### 10.4 XLSX：live编辑、公式栏、sheet与包装层UI

| ID | 操作／状态 | 已确认的宿主与包装层事实 | 定位 |
| --- | --- | --- | --- |
| O31 | 来源决定编辑 | 无artifactDocument为静态source路径；有则uo处理blocked/refreshing/fallback/starting/live，只有live controller存在才覆写isEditing=true；fallback保持只读。主宿主manualEditUiEnabled和live编辑状态是两个独立开关 | V8 lo/uo L1248–1328；原§6 O04–O10 |
| O32 | 外层默认值 | Nv默认isEditing/manualEditUiEnabled/artifactSearchEnabled/drawingAnnotations/commentThreads均false；sv虽有更宽默认，但不能越过Nv。format/editingControls要求manualEditUiEnabled && isEditing；宿主无显式artifactSearchEnabled。panelProps可注入的最终运行值另需取证，不直接宣称内层search开着 | V35 Nv L6328、sv L6129–6218、cx L7798–7815；V8 workbook分支 |
| O33 | 公式栏 | 显示当前地址或拖动范围标签、fx Insert function与formula textarea；地址标签不是地址输入框；非编辑时textarea只读且fx禁用。编辑提交/blur走controller；Codex主题缩放放header而非另加公式栏重复控件 | V35 E_ L5922–5948 |
| O34 | sheet底栏 | 只读可点选sheet；编辑时才有拖动重排、双击重命名、Add sheet。编辑sheet右键View page、Rename、Delete；interactionsDisabled阻止动作，最后一个sheet禁止Delete | V35 M_/N_/z_ L5962–6064 |
| O35 | 条件格式与单元格工具 | 自定义adapter而非简单套默认Format pane：可见文字/数值/填充/边框/对齐/换行、合并/取消合并、适应行高/列宽、fill down/right、clear contents/formats/all等配置；插入、数据验证/checkbox/conditional formatting等依manualEditUi与选区/能力。默认库demo中disabled的项不可覆盖实际自定义adapter事实；不假称所有XLSX特性已无损支持 | V35 context/config L1970–2050、custom inspector L6458–7796、cx L7798–7815 |
| O36 | 键盘实执行与分类不同 | Hp先避让输入/clipboard；`/`、ContextMenu、Shift+F10只编辑且无cell/floating editor/review冲突时打开工具；Escape清当前工具/范围；只读阻止普通字符编辑与删除。其它键交controller→worker。V37 na的copy/cut/paste/save/undo/redo/search/zoom枚举是快捷键识别/上报，不能单凭它宣称保存、查找等真的执行 | V35 Hp L2667–2743；V37 ta/na/ia L930–979 |
| O37 | 编辑结束 | controller对活跃cell：Enter/Tab/箭头提交，Escape取消；Meta/Ctrl+Enter先写formula再发键盘event；composition由cell editor完成钩子处理。worker实际选择移动、公式重算和文件持久化仍各需集成验证 | V35 controller L1132–1144、cell editor L5035–5055 |

### 10.5 明确到文件与调用的未验证边界

这次不是因“专有”而停止读取所有 JS。已枚举宿主、实际adapter、右键provider和键盘guard；余下边界是：

| ID | 已到达的具体位置 | 仍未知／后续验证动作 |
| --- | --- | --- |
| U11 | V31 L3996创建`runtime.worker-4664ab3e891e.js`，同时导入`document-df3c430bec19.js`；V32导入`controller-worker-270e891d4760.js`；V35导入`worker-98ad163d5f9e.js`并dispatch `handle-keyboard-event` | 未对全部worker/底层WASM逐函数还原；这些交接之后的排版、公式、选区移动、所有快捷键、导出保真/宏行为不可由控件标签证明。使用有明确expected的DOCX/PPTX/XLSX副本实测，失败逐项定位至worker协议，不泛称支持Office全部规范 |
| U12 | V32/V35 formatPane/plugin configuration、selectionCapabilities、runtime返回snapshot | 已列出的自定义工具仍受选区/能力/flag影响；不承诺每个OOXML对象都出现同样菜单。逐种文字、图片、表格、图表、组合对象、隐藏slide及只读/live来源做控件矩阵 |
| U13 | V27/V29新灯箱→V38→V39→图像viewport | 只读gate、标题/保存/导航/zoom宿主参数已证；图像viewport全局快捷键、触控/系统剪贴板权限、动画解码实际行为未执行。旧灯箱和新灯箱分别留参考录屏，不以普通树图片mock代替 |
| U14 | feature读取、workspaceFiles/provider与panelProps | 本机实际下发flags、某次来源状态与provider可用性未动态取值；静态默认是分支条件，不是证明安装版此刻进入该分支。全部条目保留为有条件能力，需求不因成本而删除 |

E-V7/8/9导出到 `release/m9-research/viewers/office-gallery/rea-office-gallery-bundle.json`，19 records、675,844,415 bytes；SHA与定位全集写入机器索引。原始bundle、格式化源码、REA完整结果均位于ignored release路径；受跟踪文档只记录行为、符号、短定位锚点和摘要，不提供专有库实现副本。

## 11. 迁移约束与尚待验证的清单

这些是研究建议，不替代 M9 `需求.md`。SmartDD/WillYou 应沿用已设计的 `RootRequest`（`projectId+dirId` 或 `taskId`），由主进程签发 `rootId+relativePath`；Codex 的 hostId/workspaceRoot/path 仅作为对标契约，不允许 renderer 任意组合宿主和根目录。基础文件ID、tab实例、草稿revision和保存结果应清晰分开。

| 待验证 ID | 隔离fixture动作／验收问题 | 当前证据状态 |
| --- | --- | --- |
| T01 | .md和.txt各改一次，等待>3s，看dirty与磁盘；区分500ms草稿和550ms潜在编辑 | 未知（仅静态路径已证） |
| T02 | 干净／脏 .md与源码分别由外部改盘，核对diff方向、accept/reject/edit及自动刷新差异 | 未知 |
| T03 | 保存失败时关闭：Continue viewing保留，Discard才丢弃；等待期间切换tab防误关 | 未知 |
| T04 | 10/20/40/128/256MiB的等于／超出；HTML UTF-8 bytes与UTF-16 units独立构造 | 未知 |
| T05 | 345映射选择代表性复合后缀、无扩展、未知扩展、内容伪装、空文件、CRLF/CR、非UTF-8 | 未知；不必为每个语法名宣称完整codec验证 |
| T06 | SVG/TIFF/损坏图像、PDF worker与大页、音视频codec；Notebook各种cell与MIME优先级、禁脚本输出 | 未知 |
| T07 | 同文件从树／附件／历史版本／行号／显式viewer打开，核对重复tab和可写性 | 未知 |
| T08 | PPTX etag冲突、XLSX append/materialize/刷新失败、DOCX来源回写路径与宏保留能力 | 未知；仅研究，不执行用户真实资源修改 |
| T09 | 应用退出／崩溃后草稿是否恢复；磁盘CAS、符号链接和外部修改竞争窗口 | 未知；前端快照存在不能证明持久化或安全边界 |

本轮清单已覆盖所读路由/classifier/switch的全部显式分支与四种编辑持久化模式，并补入文件查找、跳行和语义导航；第三方magic识别内部、Office解析器内部、全部媒体codec、最终feature flags与运行验收保持未知。完整文件区域仍是研究目标，不能因某类实现成本高就从需求中悄悄删去；每项能力按真实provider支持情况明确可用、错误、只读及降级状态，形成可执行验证记录。
