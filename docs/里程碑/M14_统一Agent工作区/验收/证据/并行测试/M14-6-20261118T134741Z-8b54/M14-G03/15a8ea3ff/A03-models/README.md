# A03 供应商与模型组合实包验收（2026-11-20）

- 执行：Claude Code，后台 CDP，未占用系统前台。
- 包：隔离包 `15a8ea3ff`（app.asar `006dd741a95a1b901245bea68a816dd2545ae31d81d4a92dd2dc777485649efe`），macOS 26.6.1 arm64，feature/0.1.6。
- 执行器：真实订阅 Claude Code 2.1.326、真实订阅 Codex 0.169.0（登录只在隔离测试 HOME 与测试钥匙串，沿用 [A07／A54 订阅环境](../A07-A54-subscription/README.md)）；第二供应商为真实 DeepSeek（Anthropic 与 Responses 两个协议）。
- DeepSeek 接入：App 内建自定义供应商，端点指向驱动本机记录转发器，App 只持有一次性本机测试令牌；真实 Key 只在驱动进程环境变量中，转发时替换，不进 App 环境、不写文件（驱动启动前断言 App 环境不含该 Key，归档前扫描证据无 Key）。转发器只记录协议、模型、合成标记和状态码。
- 供应商保存前按产品规则对两个模型、两种协议执行真实工具调用验证：4 项均为 available。

## 第 593 次结果：12/12 通过

| 判据 | 实际 |
| --- | --- |
| Claude：订阅轮回答且不经 DeepSeek | 回答 `A03_C_SUB`，转发器无该轮请求 |
| Claude：同一任务切到 DeepSeek，自定义模型实际发出 | 请求 model=`deepseek-v4-pro`，200，回答到原任务 |
| Claude：“默认”发送真实模型 ID | 选 `默认（deepseek-flash）`，请求 model=`deepseek-flash` |
| Claude：失效模型可见失败、不被静默替换 | 仅 `a03-retired-model` 请求（CLI 自身重试共 3 次）全为 400；回合 failed，侧栏与任务头显示“失败”；选择仍为该模型 |
| Codex：同上 4 项 | 订阅 `A03_X_SUB` 无转发；`deepseek-v4-pro`／`deepseek-flash` 实际发出；`a03-retired-model` 1 次 400，回合 failed，界面显示“工作 0 秒后失败／查看错误详情” |
| Claude 父 → Codex 子委派 | 子任务 driver `codex-app-server`、目标配置 A03 Codex DeepSeek，实际请求 `deepseek-flash`，答 `A03_CHILD_CODEX_OK` |
| Codex 父 → Claude 子委派 | 子任务 driver `claude-sdk`、目标配置 A03 Claude DeepSeek，实际请求 `deepseek-v4-pro`，答 `A03_CHILD_CLAUDE_OK` |
| 委派到目标不提供的模型（两方向） | `wy_delegate` 返回“委派目标配置或模型已经变化…”，委派行数不变，无该模型请求，未替换 |

- 截图：[Claude 失效模型](attempt-593/10-claude-invalid-model.png)、[Codex 失效模型](attempt-593/11-codex-invalid-model.png)、[委派](attempt-593/20-delegation.png)。
- 记录：Codex→Claude 子任务请求只读，实际为 write：产品按 `delegation-service.ts` 规则，仅目标可信只读时给 read，Claude 配置 `trustedRead=false`，如实登记 write（属 A 委派权限口径，非本条模型判据）。

## 失败与驱动修正（保留）

- 589：变量名与公共骨架冲突（`port` TDZ）→ 改名 `dsPort`。
- [590](attempt-590/result.json)：`agents.save` 拒绝未验证的自定义供应商（产品规则，正确）→ 驱动先调产品验证入口 `agents.checkProviderModel`。驱动失败分支未关闭转发器，进程挂起至手动结束 → 改在 finally 关闭。
- [591](attempt-591/result.json)：沿用 magpie 预设但端点非固定 3425，产品正确要求 Key → 改为自定义供应商＋一次性本机令牌。
- [592](attempt-592/result.json)：12 项绿，但 Codex 失效模型截图拍在界面更新前（仍显示“思考中”），驱动只看了 IPC 回合状态 → 593 增加有界界面等待：侧栏不再“工作中”、任务区出现错误后才判定并截图；593 两端均约 1 秒内可见失败，592 为取证时序问题而非产品缺陷。
- 驱动：[driver/](driver/)（最终版即 593 所用）。
