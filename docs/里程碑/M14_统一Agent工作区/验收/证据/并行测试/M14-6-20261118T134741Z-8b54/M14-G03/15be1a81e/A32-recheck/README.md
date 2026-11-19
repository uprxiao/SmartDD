# A32 075–076 实包前后台与父原生续跑

冻结候选 `15be1a81ebd66740d252d5835a8bee7b971dcd2e`，ASAR `1bbfc724e8e4d3a88e77f4b63a57b2de5ea0548cb5bfb6a88d89dd6b40cab48d`，macOS arm64，Codex 原生 0.169.0 和 Claude 2.1.326。每轮使用独立 HOME、userData、目录、任务和原生会话。真实工具执行作用在本批私有文件，模型回复只来自回环。

| 尝试 | 实际结果 | 证据 |
|---|---|---|
| 075 Git Codex → Claude | 补齐了 073 的「批准」操作。父收到两个 queued 收据后继续完成真正的前台工具并写文件。第二子真实点击停止，未到任何执行器。Claude 子等原父 PID 81278 结束才在唯一写槽取得权限，真实一次批准后读取父文件并写子文件。旧真人输入继续 waiting，子退役后由同 binding、同 Codex nativeId、新 generation 2 恢复，原生工具真正回传 `A32_CHILD_BYTES`。 | [全部证据](attempt-075/result.json) · [父续跑界面](attempt-075/30-parent-reads-child-file-after-resume.png) · [只读核对](attempt-075/readonly-run-and-release-proof.json) |
| 076 SVN Claude → Codex，后台 | 前台结束后，父 PID 82967、原 Bash PID 83068 确切仍活，写子没有 raw request。后台自然结束后 Claude 发同 toolUseId 的系统完成通知。暂停该旧请求的纯文字回包时，原 owner 的同一 birth stamp 仍活，只存在原 generation 1；真人后续记录仍 accepted、runId/nativeTurnId 为空，写子未启动。回包原路返回，原父退役后 Codex 子独占写入，其退出后父在同 Claude nativeId 的 generation 2 继续，实际 Bash 输出 `A32_CHILD_BYTES`。 | [全部证据](attempt-076/result.json) · [实际后台待发](attempt-076/17-background-holds-queued-child.png) · [实际父续跑](attempt-076/30-parent-reads-child-file-after-resume.png) · [只读核对](attempt-076/readonly-run-and-release-proof.json) |

两轮真实 App 均正常退出，PID 分别 81103、82819，renderer 无错误。退出后核对共享端口和包进程为空。两轮均无强制清场。

A32 还需其余目录与父执行器组合，以及已获准的宿主业务执行仍占槽、终态后放行的定向实包。已有 [A30、A31、A05 的证据对照](driver/README.md) 和 [072–074 原始失败及定位](../A32-initial/README.md) 继续保留。 [SHA-256](SHA256SUMS)
