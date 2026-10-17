# R3.4 PDF / Notebook 证据说明

`r34-pdf-runtime-report.json` 与同目录非 attempt 截图是最终冻结复验；检查每张图的 SHA-256 后使用。`r34-source-manifest.json` 记录当前实现、探针、预算及本地资源的哈希。

`report-attempt1` 至 `report-attempt7` 保留探索与故障诊断结果，不计入最终通过数，不代替最终基线。较早报告中的同名截图在后续运行被更新，旧报告的 screenshot 元数据只表示当次生成记录，旧图片并未全部保留；不要将最终同名图作为旧运行证据。`r34-failure.png` 为 attempt7 的探针初始加载超时现场。

- attempt1：评论测试坐标落到可视区域外，探针失败，随后修正坐标。
- attempt2：Notebook HTML 的 style=url() 出现外部请求尝试。测试拦截器阻止了成功访问；这是实际缺陷，先修调用处，再迁到统一 notebookFrameDocument。
- attempt3：调用处临时修复后通过，后续撤掉该重复策略，统一入口负责清理。
- attempt4：统一入口复验期间增加 class 保留，存在 HMR 变化，不用于冻结结论。
- attempt5：统一策略和同步异常清理 17 项通过；后续又把 watchdog 接入单页画布。
- attempt6：画布已正确提示“响应超时”，探针断言错写“无响应”，17 通过、1 失败；修正断言，未改产品错误语义。
- attempt7：仅引擎探针把加载 watchdog 缩到 300ms，在注入退出前就触发加载超时；调为 5 秒复验，不改变组件默认 15 秒策略。

测试只启动新的隔离 headless Chromium、只读本机合成夹具，并拦截全部非本机 HTTP(S) 请求。没有操作、启动、附加或截图 Codex。真实 Worker 与浏览器原型证据不等于安装包端到端验收；425 条正式用例未由这些探针改写。
