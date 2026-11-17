# M14 五项修复复核证据

对应[本轮报告](../review-20261117-0853.md)。2026-11-17，`feature/0.1.6`，HEAD `7c4ed737dfc03cb9b2b4509de996cdaa1af6f560`。只新增评审文件，原输入不改，未提交。

| 文件 | 内容与层级 |
| --- | --- |
| `input-baseline.json`、`changed-since-review.json`、`input-integrity.json` | 本次输入哈希、相对上一轮变化及结束核对 |
| `focused-regressions.cjs`、`focused-recheck.json` | 上轮原函数探针适配当前源码：创建结果统一 Codex 身份；首页 preparing／failed 不创建且保留输入；子绝对路径识别、完整路径复制；父／子停止状态。实际函数／原闭包＋合成外围状态，不是浏览器点击 |
| `t3-path-policy.json` | 从固定 Git 对象 `fe59fa44d0` 读取 markdownLinks.ts、config.ts、os-jank.ts 的行号、片段与完整源码哈希；证明空白排除规则及默认 `~/.t3/worktrees` 来源 |
| `prototype-tests.json`、`test-*.log` | M14 27、M9 297、parity 5、M13 57 模型测试全部通过 |
| `generator-replay.json` | A1.5／E1.5 显式生成到私有目录，两份文件与现行正文逐字节一致；75 条／66 适用／9 范围外 |
| `manifest-check.json` | P0.16 当前和 tar 中 15 项源码／配置哈希匹配，4 张截图哈希匹配 |
| `document-audit.json`、`document-audit.stdout` | 原审计只重定向本轮输出；43／43，坏链接 0；旧结果未覆盖 |
| `home-menu-ssr.cjs`、`home-menu-ssr.json`、`home-menu-open-ssr.html` | 展开菜单的 SSR 状态夹具，只把 HomeModelPicker 初始 open 改为 true，按钮／事件／父表单不变。确认关闭遮罩缺 type；不证明真实点击误建任务 |
| `home-menu-ssr-attempt1.txt` | 初次 SSR 驱动缺 CSS loader，渲染前失败；只修评审驱动并以同一夹具重跑，非产品失败 |

查看了 P0.16 已存的任务信息图与停止后侧栏图，分别显示正确的 Codex 身份和“已停止”状态。它们不是本轮新截图，也不证明完整深色验收。

本轮浏览器工具仍返回 `browser access host unavailable`，没有独立重新点击原型；未调用真实模型、未运行生产 App、未创建或迁移 `~/.willyou`。

从仓库根可复跑：`node docs/review/evidence-20261117-0853/focused-regressions.cjs`；SSR 用 `node docs/review/evidence-20261117-0853/home-menu-ssr.cjs`。其 Node 依赖实际沿用本机仓库根 React 19.3.0／Vite 6.4.4，不称为按原型声明依赖独立重装复现。
