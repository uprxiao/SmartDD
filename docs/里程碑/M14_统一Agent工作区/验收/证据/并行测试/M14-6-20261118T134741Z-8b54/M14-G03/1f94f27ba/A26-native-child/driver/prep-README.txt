# A26 同时处理四条真实请求的实包补验

档位已由 [049](../../evidence-216acf6a7-a26-049/README.md) 和 [050](../../evidence-216acf6a7-a26-050/README.md) 覆盖。两个同文宿主子问题、本地浏览器业务审批共同出现，以及错归属、取消、恢复另一个请求、旧回应拒绝，已由 [053](../../evidence-9e41d1d29-a26-053/README.md) 覆盖。原生崩溃重启旧请求拒绝另见 [035](../../evidence-10b3190e3-native-process-recovery/README.md)，属于 A27 的独立旁证。

尚缺一次同一父任务的四条真请求，其中第四条由父执行器自己的实际原生子 Agent 发起。053 的 [现有配置追证](053-managed-source.json) 显示 Claude profile 的来源是 provider，实际 binding 使用 WillYou 在本次 userData 内的托管根。冻结生产 `profile-launch.ts` 的托管设置只加载 user，053 把子定义放入 project 的 `.claude/agents`，因此实际 Claude 查不到该类型。Codex 0.169.0 的真实原生子已证明对应提问工具限制于根线程，另保留 [038 证据](../../evidence-1c9022486-a29-final/README.md)。

本轮沿用 053 原 App UI、实际浏览器观察审批、真实 Claude 的两个宿主子及同文提问，唯一夹具变化是在创建本轮 provider 档案后将一个只声明 `AskUserQuestion` 的定义加到该档案对应的隔离托管根下 `agents/`。不改原生可执行文件、SDK 工具逻辑、权限档位或调用回执。运行后核原生 binding 的 state_root 和定义摘要，真实原生子必须公布这项工具并产生待处理请求，才能进入第四条判据。

1. 驱动通过父任务真实输入和 MCP 派出两个宿主子，然后发出对同工程合成网页的只观察级业务请求，最后发起该原生子。
2. 四条实际请求出现后，从同一父任务面板翻卡，截图各来源，独立只读核 SQLite 同一批四行 pending。匹配各自 taskId／runId／bindingId／generation／revision，原生子额外匹配 nodeId 和 nativeRequest。
3. 按相同实际路径拒答第一个兄弟；错误 owner 与退役旧请求均拒绝；第二个兄弟保留仍可作答；批准固定浏览器观察；最后回答仍挂起的原生子。三种问答分别核精确原生 tool-use ID，浏览器只绑定原业务 run。
4. 若 Claude 仍未公布工具、正常请求被原生拒绝，或不存在实际带 nodeId 的挂起项，保存真实工具表、返回错误和其余三条结果，保持 `partial`，不伪造第四条。父子完成、App 实际退出并清空端口后取证。

全部使用本机私有合成项目、回环模型和页面，无用户凭据或可操作的外部环境。预检只检查私有根、原 053 数据核对及协议形状，尚未启动 App、监听和模型进程。

由协调者授予独占 App／3425 后，从指定的冻结源码目录运行。

```sh
M14_EXPECTED_SOURCE_COMMIT=<完整候选提交> \
M14_EXPECTED_ASAR_SHA256=<候选 ASAR 哈希> \
  /private/tmp/willyou-m14-stage6.WRvdST/g03/prep-next/a26-native-composition/run-a26-composition.sh attempt-<未用编号>
```

[驱动](a26-request-composition.mjs) · [私有托管设置夹具](managed-agent-fixture.mjs) · [离线预检](preflight.log) · [SHA-256](SHA256SUMS)
