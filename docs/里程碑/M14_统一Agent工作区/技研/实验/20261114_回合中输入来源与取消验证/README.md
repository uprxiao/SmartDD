# 回合中输入来源与取消验证

日期：2026-11-14。对应 Q17／Q41，并补充 Q04／Q27。沿用 Claude SDK 0.3.321／native 2.1.321、Codex 0.167.1 与 macOS arm64；不声明其他版本或平台通过。实际业务源码未修改。

本轮把[程序化启动／私有桥](../20261114_程序化启动与私有业务桥验证/README.md)的实际 run／资源租约、会话绑定、系统进程身份、私有 broker、原生 MCP bridge 和 ApplicationToolService，与[输入来源候选](../20261114_程序化输入来源与同文关联验证/README.md)联合。真实 native 经本机假模型调用一个合成只读处理器；处理器必须在 native 回合结束前取得并复核原生文件中的用户输入证明。UI sender、L3 兼容声明、binding／generation 仍为夹具，未接真实 Electron 输入或邮件授权，不是产品验收。

## 最终六个场景

| 两端各一项 | 验证结果 |
| --- | --- |
| healthy | 实际私有桥鉴权后进入只读处理器；以实时回执和实际文件记录取得来源，精确 recordHash／文件 proof 复核通过，随后 native 回合完成 |
| held-receipt | 暂扣宿主对回执的接受，业务处理器已进入但无来源；释放回执后才取得来源，仍在回合结束前 |
| cancel-receipt | 在上述等待期间停止 run；迟到回执被实际 owner 拒绝，来源证明为零；活动结束后进程及资源租约清理完成 |

[结果](result.json)为 attempt-OP5OA7 的六项通过。四项正常／延迟场景各有一份成功的文件 proof，两项取消场景均没有。每项只调用一次合成业务读处理器。两项取消中 native 仍尝试发第二个模型请求，被本机假端点的 active-run 检查拒绝；这不证明停止瞬间网络静默，也不代表生产环境已有同样网关。

Claude 用首条顶层 assistant 的 user_message_uuid 关联提交 UUID，未等 result；Codex 用 item/completed 的 userMessage.clientId，保留 thread／turn／item 映射。两端在本次样本均能于工具回合结束前完成原生文件核验，但不能推广到 steer、合并输入或多模态。

## 失败记录和设计影响

- attempt-hdtROi：直接读取来源失败，未取得 proof。attempt-vm0a3t 增加诊断后确认 Claude 回执已接受，但当时状态根下尚无 JSONL，reader 返回 SOURCE_UNAVAILABLE；两次均未放行合成业务结果。
- 候选改为先订阅文件变化、再读取，并在变化后完整复核；等待绑定当前 run、可取消、有观察上限，不用固定 sleep 推定写盘成功。attempt-hcLy3k 已取得回合中的 proof，但停止后的候选 isLatest 调用了实际 assertActive，抛异常而非返回 false。
- 只修改临时 ProgrammaticInputs 候选的查询守卫：失活时返回 false，接受／claim 路径仍拒绝。最终六项通过。该修改不是对生产源码的修复。文件变化仅用于唤醒，不能当作来源证明；超时、未知格式、缺失或歧义必须保持不可用。实验未专门注入永久缺失／文件替换、等待中取消等全部分支。

原生接受、原生文件可读、宿主来源核验和业务写入许可是四个不同阶段。持续读取事件不能被工具等待阻塞；不能等终态才提供工具执行所需的来源。宿主停止后，迟到回执不得恢复 live 来源；查询有效性与执行业务的错误合同也应分别定义。

## 证据与限制

[traces.tar.gz](traces.tar.gz)保留四次实验的原始协议、模型请求、事件序列、清理状态及当次脚本；[成员摘要](traces-manifest.json)可核对原字节。前三次使用上一轮原始 candidate.mjs，第三次后的最终候选另存于本目录；最终 attempt 内也有候选副本。[审计](audit-result.json)确认共九个 native 进程退出、所有实验租约释放、六项最终检查、四份回合中文件记录摘要，以及所用业务源码和 bundle 摘要未变化。

[probe.mjs](probe.mjs)及[candidate.mjs](candidate.mjs)是实验代码；其依赖的 bundle 构建方式见上述两份前序实验，版本／摘要见[sources.json](sources.json)。重跑需重建对应临时依赖并调整绝对路径，运行 `node probe.mjs`；离线检查可先在独立目录解开 traces，再按 audit.py 映射前序依赖路径。不得指向用户配置根或真实数据库。

正式 programmatic 类型／Schema、持久来源账及崩溃恢复、真实 UI sender、完整 MailUserAuthorizations／插件写审批／浏览器授权、原生 steer／合并仍未完成。Q17／Q41 继续标为部分；正式产品验收保持 0／54。
