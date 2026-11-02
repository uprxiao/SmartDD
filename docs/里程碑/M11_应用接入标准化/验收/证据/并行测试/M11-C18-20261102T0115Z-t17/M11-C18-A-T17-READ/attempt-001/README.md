# M11-T17 A＋R（禅道段）证据说明

- 用例：M11-T17／R13、R06（`验收/测试用例.md` 第 49 行），本 attempt 覆盖**禅道段**的 A＋R。
- 层级：**A＋R** —— 真实打包 App（`b87809c7…`，未重建）＋ 真实 Codex 0.166.0 ＋ 真实 v2 禅道能力，打向已授权的私有站点 `http://192.168.106.185/biz/`，全程只读。
- 基线：`sourceCommit fb20eca6`、`sourceDirty=false`、asar `b87809c7…`、`scripts/applications/m11-t17-zentao-v2-ui.mjs`。
- 覆盖边界（如实记录）：
  - 模型回复为私有回环夹具，只决定“下一次调用哪个声明过的命令”；业务数据、身份、连接测试、分页、详情、资源读取全部来自真实站点。
  - 连接测试与保存、项目选用走**原始 IPC 契约**（前置），不抵扣页面级 UI 覆盖。
  - 凭据由操作者提供并写入仓库外 `~/.smartdd-zen.env`（权限 600），驱动在清洗环境前读取一次，不打印、不入库。
  - **邮件段（14 个 v1 工具的真实 A＋R）按用户 2026-11-02 决定本批不覆盖**，本机无 Foxmail 与本地邮件库；该缺项不计入本 attempt 的通过范围，单独留在用例账。

## 检查项（10 项全绿）

| 检查 | 关键数据 |
| --- | --- |
| 真实凭据经原 IPC 契约完成连接测试与保存 | `availability: connected`、`identityRevision: 1`、`hasSecret: true` |
| 项目只启用本项目与该连接 | 单一项目、单一连接 |
| 会话创建前禅道包已完成验证 | `capability_resources` 内 `application-package` 为 `ready` |
| 真实输入框＋启动按钮只建了一个任务 | `taskId` 单一 |
| 每个 v1 禅道能力都映射到暴露的 v2 能力、无 v1 残留 | `capability-surface.json`（16 773 B），`unavailable: []` |
| 所有实时读取经真实 CLI 出口返回统一 v2 信封 | 6 次调用，`origin: cli`、`operation.effectState: read-only` |
| 游标分页遵守页大小且不重复行 | 第 2 页与第 1 页无交集 |
| 对象详情与 M10 基线一致（同一指派 Bug） | `id 79967`、附件 1、正文 415 B |
| 有界资源块保持 offset/length/eof 算术并重建原资源 | 1 块、拼接 415 B、声明 415 B |
| 宿主审计与运行计划记为 MCP 只读 | 5 次成功调用 |

## 文件

- `result.json`：驱动完整结果（含每次调用的 `capabilityId`、输出哈希与长度）。
- `capability-surface.json`：会话内经 `willyou-app --list` 导出的真实能力面（断言来源，避免被 shell 工具截断）。
- `progress.json`、`terminal-current.txt`：阶段推进与会话终端快照。
- `composer.png`、`task-native-response.png`：真实输入框与任务结果界面截图。
- `manifest.json`：本目录文件哈希（不含自身）。
