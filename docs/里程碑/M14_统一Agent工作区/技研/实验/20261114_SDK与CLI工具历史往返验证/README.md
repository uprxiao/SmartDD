# SDK／app-server 与 CLI 工具历史往返

2026-11-14；T0.1 §11.1，验证账 §4.73；R02／03／10／11，Q49。仅隔离研究，产品／共享原型未改。

## 已验证的四项

| 检查 | 结果与证据边界 |
| --- | --- |
| H01 Claude | SDK 0.3.321／native 2.1.321：SDK→同二进制 CLI --print --resume→SDK，三轮沿用同 sessionId、cwd、CLAUDE_CONFIG_DIR |
| H02 Codex | native 0.167.1：app-server→同二进制 exec resume→新 app-server，三轮沿用同 threadId、cwd、CODEX_HOME |
| H03 Claude 缺历史 | 当前 SmartDD claudeSessionFile 能找到 SDK／CLI 共写的 transcript；暂移后返回 null，CLI 明确失败且零模型请求，没有新建原路径；恢复后哈希一致 |
| H04 Codex 缺历史 | 当前 codexRolloutFile／recentCodexRollouts 可定位真实 rollout／索引；暂移后找不到，CLI 明确失败且零模型请求；原文件恢复且哈希一致 |

两端每轮实际执行一次合成文件读取，再生成文本回答。模型端受控响应只发命令，不把文件内容塞进提示；工具真实输出 FILE_* 进入下一模型请求。第三轮的结构化 tool_result／function_call_output 同时含前两轮结果，同时核对用户输入和回答标记。不是让模型口头声明“记得”，也不是只看文件存在。每轮结束并观察进程终态后才启动下一种入口，没有并行写同一历史。

Claude 通过证据在 attempt-UopqC9，Codex 通过在 attempt-RvCagg；原首批 Codex 失败保留。有效往返合计12次本机模型请求，连同首次 Codex 尝试共15次；两次缺历史反例零请求。八个往返相关 native 及两个缺失反例 native 均退出，未调用付费／远程模型。

## 发现的配置边界

首批 Codex exec resume 没有显式传 model，实际从 gpt-5.3-codex 变为当前默认 gpt-6.1-sol；该请求未声明 tools，受控模型端按预期拒绝。stderr 的临时目录 PATH alias 警告不是失败主因。显式传同一模型后工具往返通过。**恢复原 thread 并不证明有效配置原样继承**；入口切换仍要重新解析并固定 model、provider/base URL、凭据来源和权限参数，按已有执行计划约束执行。

已有 TaskService.recoveryOf 区分从未落盘的 fresh 与已观察历史后来缺失的 unrecoverable。迁移保留 nativeHistoryObserved 和身份来源，不能把缺失 transcript 当新空会话。实际当前定位函数可识别本批历史，但没有把新任务映射或入口切换接入 TaskService。

## T3 参考和实现要求

T3 Claude Adapter 按生命周期选择 resume 或 sessionId，并单独编译选择配置；Codex Adapter 将明确参数传给 thread/resume，另处理归档／卸载状态。WillYou 参考其身份与选择分离，不能从 T3 的原生恢复推出任意旧 CLI 版本都可回退。

SDK／CLI 切换前仍要求旧 run、后台工具、业务活动和未决写入已收束，原生身份排他占用交接成功。CLI 能读历史不等于业务权限、审批、来源证明和规范事件自动迁移。未知工具／记录保留为原始历史，未知写不重发。不同 native／SDK 版本、交互式 PTY、正式配置继承、旧任务入口和应用数据版本回退仍分别验证。

## 复跑与限制

固定 native／SDK 版本和哈希见 source-review。node probe.mjs 跑两端，node probe.mjs codex 只跑 Codex。本轮只补 Codex 默认模型参数后复验，没有为凑同批结果重跑 Claude。build-reader.mjs 在 SmartDD cwd 编译原只读定位模块；missing-history.mjs 针对已记录的实验会话暂移并恢复，复跑需替换其中的实验路径，禁止用于日常会话。

仅非交互 CLI --print／exec，未验证真实 PTY、TaskService 切换、并发写者拒绝、原生子任务／后台工具全格式、未知业务写或跨版本降级。Q49 从待验推进为部分，不能声称产品回退已可用。

[结果](result.json) · [运行审计](runtime-audit.json) · [源码／版本](source-review.json) · [摘要](archive-manifest.json) · [原生协议／历史／脚本](raw-evidence.tar.gz)。75 文件，2 份原生索引 SQLite 完整性／外键通过；当前只读模块 2 构建输入核对。
