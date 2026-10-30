# DEV167 PPTX 静态预览与权限

依据 R3.4-P1 / R06.10 / 原 F20 I/A 步骤与预期，未删减或改范围。新包 r98，feature/0.0.1 HEAD89de9af；版本0.0.5不变、未发布。

DEV167-01：PPTX 当前为静态 PDF 投影，原界面没有说明动画/切换不播放。先加组件红测（6过1红），以共享文案 `office-preview-notices.mjs` 同步生产 `pages-preview.tsx` 与共享原型 `FileOfficePreview.jsx`：显示“当前显示静态幻灯片；动画和切换效果不会播放。”仅 PPTX 显示，DOCX不显示；复用现有notice样式，不改排版/解析/保存协议或依赖。7组件绿、与15页预览回归/3真实I共25唯一代码全过0skip，最终当前测试源码I3复跑及类型过。历史2366工程测试加4新检查为2370累计唯一项，不表示本批重跑2370。

合成 OOXML 在已有 rich-source.pptx 上保留两页、文字、3x2表格、3/4原图表、notes/master/嵌入工作簿/未知部件，再加第二页64x32绿色PNG、fade及timing XML。普通可写、chmod444、显式readOnly来源三个真实FileService/root/包内retained Worker/LibreOffice I均过；后两者edit真实拒绝PERMISSION。没有构造不存在的附件业务宿主。原PDF用Poppler核对两页720x405pt、原标题/全部表格cell/第二页文字、源图片每像素RGB与alpha。

正常新r98 App，普通源可写/实际只读×浅深4组：初始只读预览、可写点编辑时才显示插入，完成编辑后隐藏；只读编辑禁用且实际指针点击不改变状态。真实100%缩放、点第二缩略页到2/2、关闭释放；8正文canvas非空，第二页green18432像素；四次原UI获取的PDF字节再由Poppler独立参照，chart raster蓝色两柱高149/199，ratio0.7487437与原3:4、共同基线相符。直接看实际page1标题/3x2表/两柱，page2原文字与绿色2:1图片；不声称全Codex/PowerPoint像素或动画播放/写回全场景等价。

源ZIP名称/顺序/全部part hash、4源bytes/inode/mtime不变；零save，chmod最终恢复。28原鉴权RPC输入及28交付结果JSON hash、24原Worker请求/24原消息V8 hash，4retained线程退出（主动terminate的exit1，不冒称线程0），10handler/Worker构造恢复。最终A/P各正常退出0/null，含失败驱动共5已知自有App父进程全闭；不操作r6/r4或日常App。

原型P仅本次新增说明同步：浅深PPTX编辑前后与DOCX不显示说明四组过；实际合成徽标明确，非真实Office I/A。P构建及Sites4过。新r98全量electron-vite编译、原electron-builder配置/afterPack打包、原六native smoke通过；使用原ABI匹配模块，无安装器/发布。81实际JS/CSS/HTML与ASAR逐项哈希一致（新bundle数量以实际构建为准，不沿用r97的82）。ASAR SHA `7398e4ecdf2c660b30f20c14e59d9fc42baf6803db175ec04ed1125349d201ed`。完整1367构建前输入快照+最终10delta可恢复1369当前输入；构建后只有guide和3验证源码变化，生产/P/native/build/依赖/版本未变。

保留失败：两次类型初稿错误；首A误取缩略canvas、次A将materializedZIP的render.sourceHash错当原文件hash，改为open/openPptx原hash与PDF/source各自核对后完整4过；首P四检查过但恢复App实际首页却等待项目编辑页，改为实际项目侧栏后完整4过并正常退出。保留所有失败结果/截图/当时driver。原型现有局部node_modules无bin，使用root已有Vite在5180，无安装；运行比较工具初稿依赖解析和ASAR raw读取错误在最终比较前修正。均非新增产品缺陷。

[173项原始证据](../验收/证据/m9-acceptance-pptx-preview-dev167-r98-20261020.json)，报告SHA `2181586856466ee74202679522b11227e6b975cfaba17a0c2c1a56191be3b2e3`。正式275/419（65.63%），141未执行/3阻塞；仅F20推进，T19raw0、系统人工、V/平台和其余原范围不变，M9未完成/发布。
