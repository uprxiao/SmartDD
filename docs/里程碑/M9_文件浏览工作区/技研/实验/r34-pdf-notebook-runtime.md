# R3.4 PDF / Notebook 真实浏览器运行时补证

依据：M9 R3.3 的 R06.5、R06.11、R06.17、D01；对应 GAP-05 与 GAP-09 的 PDF/Notebook 部分。2026-10-17，本轮只修改共享原型和隔离实验，不是正式 App 开发或 425 条正式用例验收。D01 沿用“上下文插入终端、不回车，结果止于交接”；不创建 CLI 审批、还原或完成状态。

## 结论与证据

最终冻结运行 **18/18 浏览器检查通过**，聚焦模型测试 **16/16 通过**。真实 Chromium 原生 Worker 已验证异常、静默退出、取消、重试与清理；2000 页、非嵌入 CJK、review/artifact 差异和复杂 Notebook 输出已在本机合成夹具验证。安装包资源加载、完整进程/GPU 内存、跨平台字体与长期循环仍待正式实现阶段核验，不能把本报告扩写成 GAP-09 全部完成。

- [机器结果与各检查明细](../../验收/证据/r34-pdf-runtime/r34-pdf-runtime-report.json)
- [源码、预算、夹具和资源 SHA-256 清单](../../验收/证据/r34-pdf-runtime/r34-source-manifest.json)
- [16 项单测原始输出](../../验收/证据/r34-pdf-runtime/r34-unit-test.log)
- [失败、修复与复验历史说明](../../验收/证据/r34-pdf-runtime/README.md)
- [浏览器探针](../../验收/证据/r34-pdf-runtime-check.mjs)

环境：macOS 26.6.1 arm64；Chromium 155.0.8059.80；Node v22.23.1；pdfjs-dist 5.4.296。工作分支 feature/0.0.1，基提交 d75bbaa81e924d1f9a9509ae1d068d69d4ea8ec7，工作区未提交修改以源码清单为准。最终运行时间 2026-10-17T07:33:52.542Z，1280×960、DPR 1。使用新隔离 headless Chromium，仅加载 localhost 合成原型；全部非本机 HTTP(S) 被拦截。没有操作、运行、附加或截图 Codex。

## 实现与可判定结果

| 检查 | 本轮实现与结果 |
| --- | --- |
| PDF00–05 | 显式创建 native module Worker，再交给 PDFWorker({port})，不允许 fake-worker 悄悄降级；同步无效输入也清理端口。真实 Worker 抛异常后显示可重试错误；重试 272ms。真实 Worker 自行 close 后由待执行 RPC 的 watchdog 识别；加载过程中取消用时 105ms。销毁握手最多等待 200ms，再终止自有端口。 |
| PDF06–07、14 | artifact 连续页提供画布、文本层和链接；review 仅单页画布/prev-next。两条路线实际渲染。单页 canvas/text/link 操作同样受 session watchdog 约束；在 review 的真实 Worker 自行退出后点击下一页，15540ms 显示响应超时（默认15秒阈值），避免无限悬挂。浏览器无通用 Worker exit 事件，不能声称空闲瞬间即可发现静默退出。 |
| PDF08 | 新 1148 字节 Type0 STSong-Light / UniGB-UCS2-H 夹具无嵌入 FontFile，实际提取“文件工作区 中文测试”；画布字形截图已人工查看正确。使用本地 CMap 与本机 CJK 字体 fallback；未捆绑中文字体，不代表 Windows/Linux 或所有字符集字形保真。 |
| PDF09–11 | 新 599116 字节、2000 页 PDF 连续打开/末页导航/关闭 3 轮；超过40页时正文只挂载视口窗口，缩略图仅临近页挂载 canvas，远离或卸载释放 canvas。真实加载仍需依次读取全部页尺寸，未宣称无限页/恒定解析成本。 |
| PDF12 | 每条评论独立 idle/inserting/inserted/failed/unknown；批量两条得到 inserted、unknown，保留未知条目且不自动重发。停止只停止等待，迟到回调被 scope/operation 拒绝，不停止或回滚 CLI。传递文本不以 CR/LF 结尾；回执仅表示插入，不能推断 CLI 读取、执行或完成。 |
| NB01–03 | HTML/SVG/JSON/stream/error/Vega fallback 等复杂输出可显示，不运行 Notebook。iframe 空 sandbox 与 CSP 禁脚本/连接/导航；统一 notebookFrameDocument 清理主动元素/URL 属性、资源型/转义 CSS。安全 class、静态 style 与内联格式保留。最终外部请求 0、脚本 sentinel 0。 |
| PDF13 | 测试观察到的 9 个原生 Worker 全部关闭，未处理页面异常 0。 |

预算在浏览器测量前固定于 `tests/fixtures/r34-pdf/budget.json`。预算与最终实测如下，不把测量后结果反过来改成门槛：

| 指标 | 门槛 | 结果 |
| --- | --- | --- |
| 2000 页首次可见，3轮 | 每轮 <10000ms | 1068 / 1024 / 1011ms |
| 正文挂载页 / canvas元素 | ≤8 / ≤20 | 每轮正文首/末页均2个；全部canvas 8个 |
| 主线程最长 long task | <250ms | 168ms |
| 关闭后 active Worker | 0 | 0 |
| 页面 post-GC JS heap 增量 | <20MiB | 基线10732608 → 最后14115944字节，增量3383336字节（约3.23MiB） |

这不是整个 renderer/GPU/操作系统 RSS 测量，也不能据3轮数据声称长期零泄漏。缩略栏仍有2000个轻量按钮；更大规模与辅助技术导航需正式实现阶段验证。

## 首次失败与修复

Notebook 首次真实浏览器检查发现 `style="background:url(...)"` 发出了外部资源请求尝试；探针拦截后未成功访问，仍按失败记录。修复从调用处迁到统一 `notebookFrameDocument`：禁止 url/image-set/@import/@font-face/表达式和反斜线转义 CSS，并移除主动标签/URL 属性；CSP、空权限 sandbox 与清理共同防护。后续对普通 URL、CSS import、转义 URL、image-set、静态样式保留均复验通过。这是有针对性的攻击夹具验证，不是对任意输入的完整安全证明。

另有测试坐标越界、断言文字不匹配和测试加载 watchdog 设成300ms的探针问题，均保留 attempt 报告。attempt4 存在 HMR 中途修改，不用于冻结结论；最终结果来自全部修改停止后的完整运行。旧 attempt 截图并非全部保留，不能用最终同名截图冒充旧运行，详见证据 README。

## 接口与资源

`onInsertContext(text, { source:'pdf-comment', path, commentId, page, anchor })` 可返回 Promise；接受 `{status:'inserted'|'failed'|'unknown'}`，兼容既有 `{ok:true}` 与 `terminal-no-response`。调用方负责真实终端身份/实例校验、超时和不回车，组件不自行操作 PTY。未传回调时页面明确标示模拟，不算真实投递证据。Workspace 已透传回调；本次独立 harness 回执是合成契约，不代替真实 PTY 集成验收。

新增 `public/assets/m9-pdf/runtime/` 资源从项目已安装的 pdfjs-dist 5.4.296 原样复制 CMap、standard_fonts，连同来源及原许可证共187个文件、1958597字节（约1.87MiB）。逐文件哈希见清单。新增两份 PDF 共600264字节，均由本地生成器创建，无用户资料。package/package-lock 未由本任务修改。

## 复现与后续边界

在仓库根目录执行：

```sh
node --test prototypes/m6-codex/tests/file-pdf-model.test.mjs prototypes/m6-codex/tests/file-pdf-runtime-model.test.mjs prototypes/m6-codex/tests/file-notebook-render.test.mjs prototypes/m6-codex/tests/file-notebook-isolation.test.mjs
node 'docs/里程碑/M9_文件浏览工作区/验收/证据/r34-pdf-runtime-check.mjs'
```

浏览器探针前提：共享 Vite 原型已在127.0.0.1:4176启动；本轮隔离 Playwright 位于 `/private/tmp/m9-qa/node_modules`；Chrome 为本机应用。脚本不接管已有浏览器，结束关闭自己创建的浏览器。生成器位于 `prototypes/m6-codex/tests/fixtures/r34-pdf/generate.py`，需要本机 pypdf，夹具 manifest 带哈希。

剩余验证：安装包协议/CSP下 worker、CMap及字体资源路径；真正 Electron 跨标签/任务切换与真实终端交接；全部约定加密/旋转/表单/JavaScript PDF变体；Safari/Firefox及目标操作系统；完整进程与GPU资源成本；长期大文件循环；真实源文件权限与内容更新。正式测试用例的实际结果、状态、证据与适用性均未由本实验改写。
