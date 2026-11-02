# M11-C21 · T09 有界结束与写效果边界（A 层）

- 用例：M11-T09（R09，I＋A）——可控读超时、上游 CLI 卡住、MCP 断连与写效果未知夹具
- 执行时间：2026-11-02 01:59Z（UTC）
- 基线：分支 `feature/0.1.0`，提交 `64b93db4`，工作区干净；冻结包
  `/private/tmp/willyou-m11-s7/package-c7-attempt-001/mac-arm64/WillYou.app`，
  `app.asar` sha256 `b87809c74aa2e4d9750710a053af71b9b96dd6f355790db3879384d18bd39b42`（未重建，沿用 C7/C18/C19 基线）
- Codex CLI：0.166.0，`/private/tmp/willyou-m11-t17-codex-pin/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`
- 驱动：`scripts/applications/m11-t09-fault-ui.mjs`

## 层级声明

- **A 层**：真实打包 App + 真实 Codex 0.166.0 会话 + 真实终端执行 `willyou-app`。
- **合成部分**：上游是回环合成禅道 HTTP 服务（真实 TCP/HTTP 传输，按需注入挂起、断连、取消），
  不使用真实站点数据；模型是回环 Responses 夹具，只决定调用顺序。证据里 `result.upstream`
  明确记录这一点，因此本用例**不证明**真实禅道故障时的业务结果。
- **I 层**：`src/main/core/applications/__tests__/mail-effect-boundary.test.ts`（写效果未知、不自动重发）
  与 `zentao-data.test.ts`（单一截止时间 TIMEOUT）在本次执行前于本地通过（`pnpm test` 63 例），
  归档见执行记录 C21 节。

## 实际结果（10 项检查全绿）

| 步骤 | 上游 | 观察 |
| --- | --- | --- |
| baseline | 正常 | `willyou-app zentao object list --kind bug --limit 2` 返回 1157 B v2 信封 |
| held | 挂起 20 s | 产品自身在上游层结束为 `{"code":"TIMEOUT","layer":"provider","message":"服务请求超时","retryable":true,"attemptCount":3}` |
| dropped | 立刻断连 | `{"code":"TRANSIENT_FAILURE","layer":"provider","message":"无法完成服务请求"}`，与 TIMEOUT 可区分 |
| cancelled | 挂起后 1.5 s 杀任务 | 无输出信封；会话已结束（`taskState` 记录 `gone`/`CANCELED`） |

- 写动作：会话只下发 3 条只读能力（`zentao.object.list` / `zentao.object.get` / `zentao.resource.read`），
  没有可重发的写能力；全部尝试的 `effectState` 均为 `read-only`。
- 收尾：`ownAppCleanupComplete: true`，只关闭本轮自建 App/PTY，未触碰日常实例。
- 基线读与真实传输层一致：抓到的 `$WILLYOU_ENDPOINT` 仅在本轮私有目录，令牌 `present`。

## 未覆盖

- 真实禅道服务器发生同类故障时的业务表现（合成上游不能代表真实站点）。
- Windows/Linux 平台同类行为。
