# R3.4 大文档 Markdown Worker 解析隔离

依据 M9 R3.3 R06.2、R08.11，补 GAP-03/GAP-09 的解析隔离选择。2026-10-17，独立 Chromium 中使用**当前真实** `file-markdown-model.mjs` 与 source tracking 模块，最终 **12/12 检查通过**。结论：生产候选可采用“原文状态保持权威、Worker持有完整解析对象、可转移范围索引、按视口请求渲染片段”的协议。当前 `FileMarkdown` 未接入这个 Worker，未改冻结 Markdown 源码或依赖；完整 CodeMirror 选区、输入、撤销与虚拟渲染语义仍未实现。

- [最终结果、样本哈希、源码哈希](../../验收/证据/r34-markdown-worker/r34-markdown-worker-report.json)
- [首轮12项通过记录](../../验收/证据/r34-markdown-worker/r34-markdown-worker-report-attempt1.json)：最终轮追加真实 `worker close` 事件时延，不能用首轮 `terminate()` 返回耗时冒充资源已退出。
- [独立浏览器探针](../../验收/证据/r34-markdown-worker-check.mjs)
- [探针文件哈希](../../验收/证据/r34-markdown-worker/r34-probe-manifest.json)
- 实验页面/Worker/协议/生成器/预算位于 `prototypes/m6-codex/tests/r34-markdown-worker/`，与产品组件分离。

## 冻结输入和预算

运行前固定256KiB、2MiB、10MiB UTF-8样本，包含CRLF、中文/emoji、标题、任务列表、表格、引用、公式、代码、Mermaid源和reference definitions；主体由有界长段落重复形成。JSON记录每份精确byte数、UTF-16长度及SHA-256；不拿字符数充当字节限制。另用18块语义夹具逐项对照source范围和实际窗口输出。

预算在 `budget.json` 中：原生Worker就绪<5秒；每份解析<15秒；主线程long task<100ms；取消到原生Worker关闭<500ms；注入100ms解析deadline后1秒内释放；渲染窗口≤60块；最终主页面post-GC增量<30MiB。这里是隔离可行性预算，不是普遍SLA，未在测量后放宽。

环境：macOS arm64，Chromium155.0.8059.80，1280×960，最终时间2026-10-17T07:42:23.526Z。新建独立headless浏览器，只访问本机合成Vite页面；无用户文件、外部请求或Codex操作。Vite和模块已可用；首次依赖下载/磁盘冷缓存/整包启动成本不属于本次计时。

## 实测与对照

| UTF-8输入 | Worker解析＋索引/哈希 | 含消息传递总等待 | 块数 / 索引字节 | 主线程long task |
| --- | --- | --- | --- | --- |
| 256KiB | 8.5ms | 8.8ms | 574 / 9184 | 未观测到≥50ms任务 |
| 2MiB | 40.1ms | 41.2ms | 4470 / 71520 | 未观测到≥50ms任务 |
| 10MiB | 192.6ms | 197.9ms | 22282 / 356512 | 未观测到≥50ms任务 |

同步基线调用相同真实解析模块：2MiB解析41.3ms，未观测到≥50ms任务；10MiB解析175.1ms，出现194ms主线程long task。两份索引SHA-256均与Worker完全相同；语义夹具的source哈希、范围索引和30块渲染输出也完全一致。Worker本身不保证解析更快；收益是把不可中断的同步解析工作移出主线程。

从10MiB文档按需请求并挂载60块实际渲染片段，主线程未观测到≥50ms任务，窗口构建记录约1.8ms（含探针等待计时误差，不当作精确布局/绘制成本）。没有把22282块全部挂入DOM。Mermaid仅返回源数据，未在Worker执行DOM渲染；本实验没有模拟或宣称完整编辑器滚动、测高、辅助技术与选区已完成。

| 生命周期检查 | 实际结果 |
| --- | --- |
| 解析进行中主动取消 | UI请求立即settle；Chromium实际worker close事件距取消158ms，低于500ms |
| 100ms解析deadline | 请求102.7ms返回timeout；原生Worker在请求起点后183ms关闭，索引释放 |
| 真实迟到回调 | Worker已计算旧结果后延迟250ms发回；主线程换revision并解析新文档，只接受新结果，确实忽略1条旧消息 |
| 解析中卸载 | pending、DOM和主线程索引清除；实际Worker关闭183ms |
| Worker模块启动中卸载 | 等待就绪的请求也返回cancelled，不遗留悬挂Promise或宿主Worker引用 |
| 最终回收 | 4次Worker构造/终止，Chromium观察到3个已初始化Worker全部关闭；第4个在启动期间即终止，没有观察到初始化事件。外部请求0，页面异常0 |

主页面post-GC从4314620增至25960692字节，增量21646072字节（约20.64MiB），低于30MiB。页面仍保留三份合成源字符串，传递会将部分字符串展开；这不是“零泄漏”结论，也没有测Worker峰值堆、GPU或整个renderer RSS。原生Worker关闭事件才是本实验的Worker生命周期证据。

## 解析对象为什么不能直接搬到主线程

当前 `parseMarkdown` 以不可枚举属性保存每块的 `tokens`；markdown-it token又带渲染器调用的原型方法。直接structuredClone块数组会遗漏不可枚举tokens；改为显式复制token后仍不能保留其原型方法。实验因此在Worker内部保留真实解析对象，向主线程传递 `Uint32Array[from,to,line,type]`（transfer ownership），只在请求视口时返回已渲染HTML、frontmatter元数据或Mermaid/空白源数据。主线程无需恢复整个markdown-it对象图。

所有消息携带job id和revision；Worker实例带generation。取消/超时真正terminate实例并清理定时器/索引；同步解析过程中发一条cancel消息不能打断正在执行的JS，所以不能仅实现“把取消命令放进同一个Worker队列”。下一次解析可创建新Worker。空闲Worker可复用，任务切换或卸载清空它持有的文档对象。

## 正式编辑器迁移路线

1. **原文与事务层。** 生产编辑器以CodeMirror文档与transaction作为编辑入口，保留文件revision/dirty/save基线。原始字节/EOL策略单独维护，明确原文件CRLF/CR/LF偏移与编辑器文档位置的映射；本实验的UTF-16原文范围不能直接假定等于任何编辑器的归一化偏移。输入、跨块选择、IME、撤销重做、搜索/引用和保存只改源文档，不从渲染DOM反序列化回写。CodeMirror由自身管理内容DOM，修改应通过事务和decorations，见[官方源码说明](https://github.com/codemirror/view/blob/main/src/editorview.ts)。
2. **异步解析层。** 采用本实验协议，增加file identity/任务epoch与内容revision；调度只保留最新快照，限制活动Worker与待处理队列，不为每个按键无限创建实例。先全量解析＋合并短时间连续编辑，保留严格deadline和取消；增量解析另行验证，不能假设markdown-it天然提供增量tree。新输入期间保留可编辑原文，旧decorations只映射/失效，旧结果不能覆盖新文档。
3. **视图与虚拟化。** 使用CodeMirror既有大文档视口机制，不再每次对全文建立React块DOM。按 `visibleRanges` 请求inline样式或轻量窗口内容；会改变垂直布局的block widget/跨行replacement必须由直接提供的decoration集合管理，不从依赖已计算viewport的间接函数引入布局反馈循环。官方[系统指南](https://codemirror.net/docs/guide/)与[装饰示例](https://codemirror.net/examples/decoration/)明确这些边界。KaTeX/frontmatter/代码可复用本实验DTO；Mermaid在可见widget挂载时渲染，内容变化/卸载取消并清理observer，异步尺寸变化触发测量。
4. **保留选择与编辑语义。** 富文档的源码显露应由真实selection范围决定；atomic替换与可精确映射文本分开处理。表格、引用、列表、数学、代码、图片、frontmatter要逐项验证跨行选区、键盘导航、滚动定位、焦点和IME；不得因为Worker输出正确就宣称参考CodeMirror装饰/selection机制已复刻。
5. **生产接入门槛。** 打包后的Worker URL/CSP、协议字节上限/响应schema、当前file revision核对、应用退出清理、主/Worker峰值内存、连续编辑与多标签压力完成后，才能把这个候选接入真实App并更新正式验收。继续沿用R06/R08大小分级，超时给明确保留原文的状态，不擅自把已确认范围缩成任意更小文件限制。

CodeMirror路线是依据官方机制提出的迁移设计，本轮没有安装CodeMirror、改造生产编辑器或运行其交互验收。官方页面直接open曾返回403，随后通过官方站点/官方GitHub的搜索索引核对了以上约束；没有引用论坛结论代替官方依据。

## 复现和剩余验证

共享Vite在127.0.0.1:4176，隔离Playwright位于 `/private/tmp/m9-qa/node_modules` 时执行：

```sh
node 'docs/里程碑/M9_文件浏览工作区/验收/证据/r34-markdown-worker-check.mjs'
```

本轮未执行单行数MiB、深层嵌套、恶意正则/极端数学/巨大表格等所有高复杂度文档；Worker隔离与真实deadline已验证，但这些样本的可用性能与峰值内存仍须补充。正式CodeMirror状态/视口适配、完整格式编辑语义、真实包生命周期与跨平台结果均不由12项实验代替。425条正式用例的状态/结果/适用性没有被本任务修改。
