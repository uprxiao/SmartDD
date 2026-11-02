# M11-C19 · T37 Skill 渲染哈希一致性（A 层）

- 用例：M11-T37（R10、R02；I＋A＋R），补齐此前缺失的“运行计划记录的 Skill 渲染哈希与实际交付一致”。
- 时间：2026-11-02T01:28Z（本机 macOS 26.1 arm64）
- 构建：冻结包 `/private/tmp/willyou-m11-s7/package-c7-attempt-001/mac-arm64/WillYou.app`，ASAR `b87809c74aa2e4d9750710a053af71b9b96dd6f355790db3879384d18bd39b42`
- 基线：`feature/0.1.0` 提交 `37ccc59fef0c0d8d4905e2f53f707ff39705a54d`，工作区干净（`sourceDirty:false`）
- 驱动：`scripts/applications/m11-t37-skill-render-ui.mjs`（真实打包 App＋真实 Codex 0.166.0＋真实 Codex CLI 会话；模型为 loopback 合成夹具，只挑已声明的调用）
- 连接：真实禅道 `192.168.106.185` 只读连接经 IPC 契约测试并保存；口令由操作者放在仓库外私有文件，驱动只记录“存在/长度”，不落盘不回显

## 断言（6 项）

1. 真实禅道连接经原 IPC 契约测试并保存；
2. 项目选用只启用该项目与该连接；
3. 会话创建前禅道包已完成校验；
4. 真实输入框与启动按钮只创建 1 个任务；
5. 三个 v1 禅道能力全部映射到 v2 能力，无遗留 v1 工具；
6. **运行计划中每个 Skill 的 `renderedHash` 与磁盘上实际投放的字节重算值一致**。

第 6 项按产品的同一公式重算（`run-plan.ts:26` `skillFilesHash`：对 `bundle.json` 登记的文件按码点排序后取 `{path,sha256,size}` 规范化 JSON 的 SHA-256）；产品自身在 `agent-adapter-registry.ts:133` 用它校验交付内容，不一致即抛 `HASH_MISMATCH`。本次两个 Skill（`bug-analysis`、`story-review`）各有 2 个文件，重算值与计划值逐一相等。

## 结果

- `result.json`：`status=passed-skill-render-hash`，`checks=6`，`calls=1`（会话内一次 `willyou-app --list` 探测，证明 Skill 投放同时下发了 v2 能力面）。
- 计划内应用：`zentao:cli`（生效入口 CLI）。
- 渲染哈希：`81a24696…`（bug-analysis）、`3b57ec65…`（story-review），重算一致。

## 边界

- 会话隔离：全新 HOME／CODEX_HOME／userData，最小化驱动环境，外网代理指向不可达回环，仅放行 `localhost` 与真实站点。
- 未覆盖：真实模型推理（合成夹具代替）、邮件相关能力（本批按用户决定豁免）、Windows／Linux 平台。
