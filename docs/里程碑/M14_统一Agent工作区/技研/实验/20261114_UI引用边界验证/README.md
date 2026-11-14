# 现有文件引用组件的 UI 迁移边界验证

日期：2026-11-14。SmartDD 源码基线 `40ea344a930aec37e36a803b7c621d3632d2d75a`；macOS arm64，Node 26.5.0。属于 M14 设计验证，不修改正式源码。

## 方法与实际范围

`probe.mjs` 通过 esbuild 打包现有 `src/renderer/features/files/terminal-context/store.ts` 及实际共享 Schema／格式代码。仅将 renderer IPC 模块替换为空默认对象，再经现有构造函数注入假 API。用 deferred Promise 控制异步节点，不调用真实模型、业务写服务或 PTY。依赖复用临时 owner 实验目录中的 esbuild 0.25.12、zod 4.6.7；完整输入哈希见 `build-inputs.json`。

在独立临时目录执行 `node probe.mjs`，源码路径与临时依赖路径在脚本中显式配置；换机器重放时先调整这两个路径。仓库归档不包含 node_modules 或 bundle。`manifest.json` 校验归档文件，不代替输入源码哈希。

## 结果

`result.json`：7／7 实验项通过。

| 编号 | 实际检查 |
| --- | --- |
| U01 | 采集不插入；明确插入只调用引用投递，通知“尚未提交”，绑定原任务 |
| U02 | bind 挂起时切目标：迟到 binding 被 release，不 prepare／insert |
| U03 | prepare 挂起时切目标：不派发 insert，也不聚焦旧／新目标 |
| U04 | insert 派发后切目标：迟到成功不改现有上下文，不聚焦，不重发 |
| U05 | 派发后传输失败：状态 unknown，引用保留，重复 insert 被阻止 |
| U06 | 不匹配 operationId：unknown，引用保留，不聚焦 |
| U07 | 换文件根后收到旧成功：新上下文保持 idle、空通知，不聚焦 |

U07 的新上下文为空，没有验证新根已经加入引用的场景。U01 的“未提交”仅指 store 的调用和通知；没有运行真实终端观察 Enter 行为。没有验证超时计时器、所有文件格式、宿主授权、真实 IPC、语音、插件审批或新草稿输入框；不能用于宣布新 UI 通过。参考现有 `store.test.ts`，本脚本仅为隔离环境下的窄范围重放，并非新增生产测试。

## 设计影响

保留 epoch、固定投递目标、operationId、unknown 不重发及来源授权；新任务使用独立 composer 目标，不伪造 ptyId。新的草稿版本 CAS、首次消息防重和事件订阅仍待验证。现行要求只维护在 `技研/技术方案.md` §10。
