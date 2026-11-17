# M14 修复回执复核证据

对应 [复核报告](../review-20261117-0006.md)。2026-11-17，`feature/0.1.6`，HEAD `7c4ed737dfc03cb9b2b4509de996cdaa1af6f560`。本目录只保存本轮评审产物，未改需求、方案、原型、研究脚本或生产代码。

| 文件 | 内容与证据层级 |
| --- | --- |
| `input-baseline.json`、`input-integrity.json` | 开始时输入哈希及结束核对；未提交工作区的文件身份，不是新 commit |
| `prototype-tests.json`、`test-*.log` | 实际运行原型模型测试：M14 26、M9 297、parity 5、M13 57；不是浏览器操作 |
| `generator-replay.json` | 生成器显式输出到 `/private/tmp`，两份生成结果与现行文档逐字节相同；75 条／66 适用／9 范围外 |
| `research-tests.json`、`replay-corrected-path.log`、`timeline-replay.json` | 在仓库外复制研究脚本、夹具后执行；录制回放 34 项、合同 15 项及新增录制断言通过。首次 T3 路径错误保留在 `replay.test.mjs.log`，改用实际本机检出后成功 |
| `merge-check-cases.log` | 原回归 5/5 通过；冲突用例预期产生的 Git stderr 不是测试失败 |
| `worktree-merge-negative.mjs`、`worktree-merge-negative.json` | 新反例：原 `hostCheck` 在 linked worktree 内漏查进行中的 cherry-pick。仅对外部副本增加 export，函数体未变；私有 Git，不调用模型 |
| `semantic-probes.cjs`、`semantic-probes.json` | 实际归一器／命令查询函数，以及从实际源码提取的 submit 闭包；合成失败输入，不是新的真实模型实验或 React 浏览器测试 |
| `*-ssr.html`、`prototype-static-render.json` | 原 React 组件静态渲染；四个主任务请求场景没有停止按钮。SSR 不执行 useEffect，不证明点击／焦点／视觉效果 |
| `document-audit.json`、`document-audit.stdout` | 现有审计只重定向结果输出，43 项通过，坏链接 0；未覆盖旧审计结果 |
| `v16-record-audit.json` | V16 已有 summary 的只读核对与哈希，未重跑模型；委派和子完成仍是桩／脚本 |
| `t3-orphan-policy.txt` | 从 T3 固定 Git 对象 `fe59fa44d0` 读取的孤立回合处理原文与完整源文件哈希；不是当前工作树推测 |
| `manifest-check.json`、`manifest-agents.diff` | P0.14 归档 15 项和 7 张截图哈希匹配；当前 AGENTS 与归档不一致。首次 tar 路径前缀判断错误留在 `manifest-check-attempt1.json`，纠正后按原型相对路径核验 |
| `private-run.json`、`environment.json` | 外部副本路径和检查边界 |

本轮浏览器工具仍返回 `browser access host unavailable`，没有独立重新点击原型；查看了已保存的“请求面板保留停止键”截图，它对应 `team` 场景。未调用真实模型、未使用日常凭据、未运行生产 App，未提交／推送。

可复跑：从仓库根运行 `node docs/review/evidence-20261117-0006/semantic-probes.cjs`。Git 反例依赖 `private-run.json` 指定的外部副本；换机器时将 probes 的 `merge-agents.mjs`、`lib/` 复制到新的私有目录，只增加 `hostCheck` 的 export，更新本目录副本中的 `private-run.json`，不要在原证据目录运行带清理副作用的探针。
