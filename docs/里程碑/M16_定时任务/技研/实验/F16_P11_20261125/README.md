# F16 P1.1 运行详情原型复验（2026-11-25）

依据：[需求 §3.7](../../../需求.md)、[原型 P1.1](../../../原型/原型说明与变更.md)，生产参考提交 a0acddb3a2325c6bf732adaa7e954ce4d767a2c3、feature/0.1.7。用户希望实际执行情况及最终结果优先查看；本轮仅修改共享交互原型与相应开发前文档，未正式开发。

| 项 | 结果 | 记录 |
| --- | --- | --- |
| 原型状态／模型单测 | 29/29 | [日志](m16-model.log) |
| React/jsdom 交互分组 | 7/7 | [驱动](prototype-interactions.mjs) · [日志](prototype-interactions.log) |
| M14、M9、M13、parity 既有回归 | 33/33、297/297、57/57、5/5 | [M14](test-m14.log) · [M9](test-m9.log) · [M13](test-m13.log) · [parity](test-parity.log) |
| 独立 Vite 构建 | 通过，已有大 chunk 提示 | [日志](vite-build.log) |
| 独立 Chrome 浅深色实际截图 | 八图，1440×900；检查完成、工作中、待处理、派发前失败、部分失败、跳过、结果未知；结果优先布局，无大弹窗；细节可滚动 | [原型截图与源码基线](../../../原型/原型说明与变更.md) |

交互检查：历史按记录创建顺序、且只在同计划切换；切换运行/任务预览保持原记录身份；结果、过程、合成文件查看与折叠；未确认或跳过不虚构消息/结果；失败保留部分输出；待处理与未知状态继续原发生，不盲重发。React 交互是原型层，Chrome 使用隔离 profile 仅渲染合成页面；不是实际任务、真实结果、系统窗口或正式 A 层验收。一次中间回归发现按 scheduledFor 重排会掩盖刚触发的手动运行，改回账本创建顺序并补反例。

复验命令（仓库根）：`node --test prototypes/m6-codex/tests/m16-model.test.mjs`、`node docs/里程碑/M16_定时任务/技研/实验/F16_P11_20261125/prototype-interactions.mjs`；共享原型目录运行 `npm run test:m14`、`npm run test:m9`、`npm run test:m13`、`npm run test:parity`、`./node_modules/.bin/vite build --outDir <独立临时目录>`。
