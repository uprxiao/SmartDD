# A14 目标等待真实子任务、切换拒绝及清除竞态

2026-11-19，macOS arm64。签名候选 `4f1d4c0a215820ce9256fce8bdd529986dc0d17b`，ASAR `0116ddf8720e421e00f6e3d8d48dbede8a493400eda18ccda34faf45f29fe6f0`。实际 Codex 和 Claude，独立本机合成模型端点，后台 CDP 操作实际控件。

- 169 未先通过界面开启委派。实际 `wy_delegate` 明确拒绝，夹具也未解析这个拒绝的分段格式，产生本地响应错误。App 退出 0，保留原始夹具失败。[原始结果](attempt-169/result.json)
- 171 从真实控件开启后，活动中的 Codex 目标通过原生业务工具委派实际 Claude 写入子任务，宿主自动暂停原目标并显示等待。同档案可选，其他档案和执行器锁定，切换服务实际拒绝。待 Claude 完成后真实点清除，目标没有消失。App 正常退出。[等待锁定](attempt-171/01-waiting-on-real-claude-child-locks-switch.png) · [实际结果](attempt-171/result.json)
- 173 重现同一流程，隔离观察器只记录真实点击后原 IPC 的返回。第一次清除立即回 `STATE`「会话尚未打开」（D06-52）。等待在途通知结束、会话就绪后，实际再点清除成功。下发旧选择修订被拒，最后实际切到 Claude。隔离 App 正常退出。[真实回执](attempt-173/result.json) · [首次清除失败](attempt-173/02-original-goal-clear-rejected.png)

175 在新包 `463155a0f` 同夹具通过。真实点击先于新运行 `run.active`，清除请求等待 563 毫秒后只返回一次成功，目标收到实际 cleared，过期选择仍拒绝，随后能正常切到 Claude。App 退出 0。D06-52 关闭。[实包回执](../../463155a0f/A14-waiting-goal/attempt-175/result.json) · [两包数据库及回执](../../463155a0f/A14-waiting-goal/attempt-175/clear-timing.json) · [构建和红绿回归](../../../build/candidate-463155a0f/README.md)。

结合[三类切换与目标隔离](../../703ec066f/A14-selection/README.md)、[在途队列先归原运行](../../../M14-G02/c098d03dc/A28-deferred-switch/README.md)与过期预检集成用例，A14 完整通过。
