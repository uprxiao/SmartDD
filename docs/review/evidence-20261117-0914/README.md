# M14 全链路复核证据（2026-11-17 0914）

对应 [Review Report](../review-20261117-0914.md)。本目录只记录评审结果，不代替阶段验证账或产品执行账。

- `input-baseline.json`：评审开始时 2052 个输入文件的 SHA-256；`production-reference-baseline.json` 是后续具名读取的生产参考文件及 M13 需求。`input-integrity.json` 核对评审结束时原输入未变化。
- `focused-regressions.cjs`：复用前轮实际处理函数定向回归，在当前输入上重新执行，结果为 `focused-recheck.json`。
- `home-menu-ssr.cjs`：实际首页、模型选择器和附件组件静态渲染；仅在内存将菜单初始状态设为展开，并传失败图片／文件引用夹具。结果证明当前渲染按钮的 type，不能证明浏览器提交或焦点行为。
- `cross-artifact-probes.cjs`：编译当前实际组件，在内存用可重复的 hook 状态调用其真实处理函数；只替换被评审模块的 hooks，保留原 JSX、处理函数、导入的纯模型。**不执行 effects，不使用浏览器或 Provider**。草稿、请求切换、邮件修改、扩展开关等均用合成状态；输出 `cross-artifact-probes.json`。
- `check-cross-contracts.cjs`：将上述实际输出与需求合同对比，当前 8 条断言失败为本轮保留的反例，退出码 1 是预期取证结果；不计作产品测试结果。邮件以请求身份与审阅修订的组合比较，不要求每次换 requestId。
- `test-*.log`、`prototype-tests.json`：当前工程现有四组测试，共 386 项通过。使用工作区现有依赖，没有独立 npm ci；实际依赖版本见 `environment.json`。
- `timeline-replay.json`、`runtime-contract.json`、`new-recordings.log`：会写 results 的研究脚本复制到私有临时根运行，真实录制只读。现有 34、15 项分别通过；它们未检测出全部新反例。
- `merge-check-cases.log`：确定性合并核对脚本的完整输出，临时仓库中执行 9 项正反例；没有模型调用或完全访问权限提升。`private-run.json` 记录本轮私有根。
- `document-audit.json`：复用原 43 项审计，唯一改动是将结果写入本目录，不改变断言或覆盖原结果。
- `generator-replay.json`：真实用例生成器输出到临时目录，两份生成结果与现行 A1.5/E1.5 逐字比较。`case-index.json`、`case-requirement-map.json` 为审查导航，不是新的用例来源。
- `manifest-check.json`：核当前及 before-L02 的 manifest／源码压缩包和截图哈希；当前源码另与工作区比较，不把截图哈希正确当作视觉验收。
- 本轮另用图片查看工具观察归档的 `p16-任务信息为所选执行器.png`、`p16-子任务绝对路径打开工作副本.png`、`p16-首页附件准备中不创建任务.png`；其哈希在 manifest 核对内。子任务图显示工具栏逐字换行（AR14），另外两张为深色，说明文档“4 张浅色”不准确（AR13）。这些是既有图片，非本轮重截图。
- `browser-availability.json`：CUA 连接服务不可用；本轮没有新的浏览器点击、原生 IME、真实 App 验证。

可从仓库根复跑 `node docs/review/evidence-20261117-0914/cross-artifact-probes.cjs`，再运行同目录的 `check-cross-contracts.cjs`。脚本仅写本证据目录；修复后应另建新的复核目录保留本轮反例，不覆盖本轮历史结果。
