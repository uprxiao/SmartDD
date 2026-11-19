# M14 A20 普通目录实包复验

使用候选 `ba735fbe1e00145cf2d02afc70f43bb8c6524755`，ASAR SHA-256 `4f4f1dfa5162632b6ea7e464ae0098d943cb4f32aed2d49048b7c4611b110df1`。macOS arm64，Claude 2.1.326 和 Codex 0.169.0。用原生 Claude 调用宿主 MCP，用原生 Codex 执行子任务。模型只用本机回环合成文本。设置操作均经同一个隔离 App 的真实后台输入。

## 046 已通过的判据

- 正常原生目录返回已配置目标身份与修订。通过设置编辑同一个 Codex 档案，唯一变更字段为 name。父保留原来的运行。 [真实设置截图](attempt-046/10-a20-real-settings-rename.png)
- 将原 profileId、原 revision 作为 profileRevision 发给正常委派工具。工具对准确 call ID 返回 INVALID_INPUT，指出目标配置或模型已经变化并要求重新查询。应用与持久化查询均为一个父任务和零委派。 [拒绝后截图](attempt-046/20-a20-stale-revision-no-child.png)
- 重新查询后同 ID、新修订，用同一文案和新请求键接受一次。以现有已受理键并带旧修订重放。回执逐字段相同，差异前后只有一个子任务。 [收据核对截图](attempt-046/30-a20-one-child-after-native-replay.png)
- 父结束后这个子通过原生 Codex 恰好一次文本请求完成并回流，最终一个委派，两条任务。App 原 PID 40940 正常退出 0，renderer 无错误，隔离代理原 PID 40939 已停止。 [完整结果](attempt-046/result.json) · [正常退出前观察](attempt-046/before-quit.json)

这一轮覆盖查询到接受的变更、原收据去重与之后的普通目录派发。A20 中另在受理后变更目标的准备及派发窗口待独立实包执行。

## 045 驱动修正

同包，真实设置已开启 M14。由于设置页不挂工作区侧栏，驱动在查找任务入口时超时，尚未发原生 MCP。App 原 PID 39298 正常退出 0。驱动复用设置页真实返回按钮，回工作区再访问原父任务。 [原结果](attempt-045/result.json) · [原驱动](attempt-045/driver-before-nav-fix.mjs) · [新版驱动](a20-ordinary-packaged.mjs) · [新版预检](preflight.log)
