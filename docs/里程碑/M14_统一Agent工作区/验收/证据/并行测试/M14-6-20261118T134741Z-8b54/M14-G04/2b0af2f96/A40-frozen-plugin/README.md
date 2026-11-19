# A40 插件冻结资源实包恢复（D06-56）

2026-11-19，macOS 26.6.1 arm64，feature/0.1.6，签名候选 `2b0af2f9604db03d8e8062e72517f4a9fb68b92e`。真实 Claude 2.1.326、本机合成模型响应、独立用户数据和合成插件。 [构建与哈希](../../../build/candidate-2b0af2f96/package-2b0af2f96-sha256.txt) · [旧包反例及两端定向集成测试](../../1b1680eea/A40-frozen-plugin/README.md)

| 尝试 | 实际结果 |
| --- | --- |
| 198 | 真插件安装、首页建任务和原生启动成功。真实 Claude 日志显示 `willyou-a40-lifecycle-fixture:a40-proof`。本机模型夹具误判工具清单所在的消息块，返回 400，未执行 Skill 内读取。 [原始结果](attempt-198/result.json) · [独立验证](verified-198.json) |
| 201 | 同一签名包以修正的读取判据再次由真实首页启动，实际插件调用返回 1.0.0。真实 Claude 的 `Read` 工具返回冻结副本的相对资源 `A40_RELATIVE_SKILL_1_0_0`，同一运行和工具结果均收口。App 正常退出，原进程关闭后冻结根回收。D06-56 启动缺陷完成复验。 [原始结果及真实回执](attempt-201/result.json) · [实际插件和 Skill 界面](attempt-201/01-original-plugin-and-skill.png) |
| 201 后段 | 第二项原生插件调用实际进入 1.0.0 子进程并留有 operationId／runId／PID 与租约。点击更新时，测试文件夹选择桥拒绝该对话框参数，未发生更新。收尾释放原调用，数据库只保留原安装，无更新变更。兼容、不兼容版本升级、停用和保留数据卸载继续验收。 [失败现场](attempt-201/97-failed.png) |

源修复同时有 Claude 和 Codex 新任务启动的真实宿主集成覆盖。本组实包再用 Claude 取证，未在该组使用 Codex 实际模型服务。

## 插件变更与停用反例

- 208 实际执行兼容升级和删除旧能力的升级。两个在途回执分别使用原 1.0、1.1 版本，归账成功后才换活动包。旧运行的 Skill 固定在 1.0，新运行各取 1.1、2.0。需要接口 99 的包被实际拒绝，旧能力删除后旧运行的调用明确失败。 [真实升级结果](attempt-208/result.json)
- 209 实际全局停用后，另一个运行的新调用立即收到拒绝。原插件子进程从已在途调用返回完整原值，宿主却把同操作记为 `failed / APP_NOT_ENABLED`，真实 Claude 收到该错误。独立核验原生 transcript 中仅一次对应结果、数据库仅一次实际执行。本机实验模型拒绝错误回执而产生的重复 HTTP 输入与插件执行分开统计。登记 D06-57。 [实包红测](attempt-209/result.json) · [界面](attempt-209/97-failed.png) · [集成红测](a40-disable-red.log)
- 210 经真正的弹框选择保留数据卸载。旧回执交付后才完成卸载，旧运行仍可读冻结 Skill，新插件调用收到 `NOT_FOUND / 插件已卸载`。私有文件及项目设置核对，数据哈希不变，新运行没有加载该插件。 [实包结果](attempt-210/result.json)
- 三次 App 均正常退出。 [实物、数据库与原生回执独立核验](verified-208-210.json) · [文件夹选择预检](preflight-folder-picker.log)

首次扩大回归在受限沙箱无法建立本机应用通道，结果只记录环境边界。后续使用隔离测试资源重新跑生产通道。 [原日志](a40-restricted-environment.log)
