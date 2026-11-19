# A38 应用结果插入后切任务和 Provider

2026-11-19，macOS arm64。签名候选 `1da88d8f85325d76474f1125427646aa56776848`，ASAR `f06168649ff9a1eec9fb5cdbbb2238bcf9778e2613cd486a427c8bdb8df584bd`。真实本机 Codex 和回环合成模型。邮件草稿没有账号或收件人，不执行邮件发送。

- 159 实际点击邮件草稿的“交给 Agent”。正确任务保留原文字并新增草稿引用，未开始新回合，文件仍有未保存编辑。切到第二任务后 UI 输入为空。夹具误以为空草稿必须包含空字符串字段，提前结束。隔离库的真实格式为修订 0 和空对象，已用于修正断言和正负样例；App 正常退出。[原始记录](attempt-159/result.json) · [两任务草稿数据核对](attempt-159/159-actual-draft-rows.json)
- 160 从独立数据重跑。插入应用结果和从第二任务回切、切另一 Provider 均实际点击。两次切换后原任务的草稿、真实未保存文件和同一待保存操作均保留；其他任务依旧无草稿内容或新回合。夹具只暂缓该测试文件的实际保存进入原处理器，解除后原处理器写盘成功且摘要匹配。App PID 88877 正常退出，无界面报错，精确回环和子进程均已收口。[实包回执](attempt-160/result.json) · [插入后](attempt-160/A38-application-result-and-dirty-buffer.png) · [两次切换后](attempt-160/A38-application-reference-after-task-and-provider-switch.png) · [退出回执](attempt-160/cleanup.json)

引用和冲突走文件面板的其他判据已有实包证据。真实 Typeless 的授权、转写和系统回填仍待验证，102 只模拟语音边界。
