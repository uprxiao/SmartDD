# A40 两端原生任务在冻结插件 Skill 时启动失败（D06-56）

2026-11-19，macOS 26.6.1 arm64，隔离签名候选 `1b1680eeab910d29a5e86dbe73698f27c93b4bdf`。测试使用本机 Claude 2.1.326、本机合成响应、无网络能力的合成插件。

- 191 真实插件安装成功，首页实际进入完全访问。夹具选择器漏匹配“权限”后缀，在发送前退出。 [原始结果](attempt-191/result.json)
- 193 修正选择器后从真实首页创建任务。创建成功后原生未启动，数据库的 run 为 `failed/OPEN_FAILED_UNFORKED`、PID 为空。时间线记录“Skill 冻结目录必须属于本次已准备运行”。隔离 App 正常退出，未向本机模型服务提交任何请求。 [原始结果](attempt-193/result.json) · [独立 DB 核验](verified-193.json) · [实际界面](attempt-193/97-failed.png)
- 运行进入 `prepared` 后才物化所属冻结 Skill，启动前仍校验本次范围与字节。失败后沿原占用释放路径回收确已结束运行的冻结目录。修复提交 `2b0af2f9604db03d8e8062e72517f4a9fb68b92e`。两个本地集成反例在旧实现都以相同错误失败，修复后分别成功准备 Claude/Codex 资源并在实际发出前取消和清理。 [定向两端失败](a40-native-skills-red.log) · [定向修复回归](a40-native-skills-green.log) · [类型检查](a40-native-skills-typecheck.log)

待同路径实包复验。插件升级、停用与保留数据卸载各按原用例继续执行。
