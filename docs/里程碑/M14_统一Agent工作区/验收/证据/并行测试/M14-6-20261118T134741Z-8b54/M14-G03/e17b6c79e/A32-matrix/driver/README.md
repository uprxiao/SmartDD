# A32 共用目录的父子交槽及原生续跑

现行用例要求三种目录分别做两种真实原生方向，并核 queued 后继续写、回合结束及排空、待发子取消和由原父读取子文件。旧有证据可复用下列具体判据。

| 实际证据 | 已覆盖 | 仍需本条补足 |
|---|---|---|
| [A30 057](../../../68fbd2c79/A30-directories/attempt-057/result.json) | Git 共享、SVN、普通三目录真实收据和共用 cwd。父自然结束前子没有 native run，之后子真正写文件，结果送父。 | 交叉执行器、父已知收据后继续写、同原生绑定读子文件。 |
| [A31 三类 FIFO](../../../15be1a81e/A31-directory-fifo/README.md) | 父子边界、严格先后、同根唯一 writer。真实 acquire／release 事件及四项证明。 | 用户在持槽父上留下新的输入时不插队。 |
| [A27 021](../../../evidence-fef791bc6-local-collaboration/attempt-021/result.json) 及 [027](../../../evidence-a88ae2016-stop-native/attempt-027/result.json) | 实际关系面板停止单个未启动排队 writer，父和无关任务仍继续。真实整树原父终态和清场边界独立复验。 | 同一交叉执行器矩阵中顺便再次核对取消不影响剩余 writer。 |
| [A05 098](../../../../M14-G04/37c6540bd/attempt-098/result.json) 与 [099](../../../../M14-G04/19d265b98/attempt-099/result.json) | 真实 Claude 前后台生命周期、原进程身份、重启退役和同 nativeId 新进程续跑。 | 正在等待该后台活动的实际共用目录子任务未启动，结束后正确取得写入资格。 |

## 实包驱动

按目录和父执行器传参。子固定使用另一执行器。每个尝试用不同 HOME、userData、工作目录和任务。仅回环合成模型，真实 App、生产 bridge、原生 Codex 0.169.0 和指定 Claude 2.1.326。操作者步骤走真实 CDP，项目和 profile 由正常服务预备。

- 通过真实原生工具列目录，按 profileId/revision 委派两个共享写入子。按实际 tool id 读取原生 queued 收据。父仍在原始回合时在 UI 排入后续输入，单独点击停止第二个待发子。待发子与继续的子身份始终分开。
- 原父收到回执后，通过真实 Bash／Codex 命令写本轮文件。命令在真实原生进程中等待有限的本机测试释放标记，等待期间本应进行的子没有原生请求。释放后父继续写并自然结束。
- 子拿同根唯一 active 槽后，用真实写工具读取父文件并写回自己的文件。在子实际占槽时保留父的后续输入为 accepted，捕获父「等待 1 个子任务」。子自然结束后验证安全释放，原待发输入恢复到父原 binding 和原 nativeId、新 run generation，经真实原生工具读到子文件字节。
- Claude 父时可加 `background`。真实 Bash 后台 PID 存活、父前台回合完成而子仍 queued。只由隔离标记放行后台，按原运行 PID 和状态确认父退出后才见子实际启动。实际程序也记录父子精确输入、回执与授权。
- “真实宿主业务执行占用”由 `business` 专项检查。先通过生产安装接口在私有 App 数据准备零连接、零凭据插件。Claude 原生收到实际等待批准回执后，仅用真实 App 批准。插件实际写入一次私有凭证并等待同一 operationId 的释放；父继续经真实原生工具派两个共享写子，在任务关系卡取消仍排队的第二子，随后实际继续本轮 Bash 写父文件并结束前台。只要真实业务仍执行，子必须 queued，不能创建原生运行；插件原样回执并落下终态之后才放行子。实际子完成文件写入但当前回合仍被本地回复门闩保持时，用户输入再进入排队。子退出后复用同一个原父读取断言，实际验证新运行代次沿用同一原生会话，Bash 输出子文件标记。既有 A05／A72 不替代该交集。该驱动在共享子创建前查准原业务请求、插件 PID 及出生时间，原父前台完成后再次确认同一插件 PID、同一原父 PID 尚在，子无历史 native run。插件回执后在 SQLite 逐事件验证原 request.resolved 先于同一子 queueId 的 directory.acquired，另查原父运行退出。插件池进程本身可以保留，依据业务实际调用结束与原父 owner 排空。

从冻结源码、获得协调者独占 App 和回环槽后运行。

```sh
M14_EXPECTED_SOURCE_COMMIT=<候选完整提交> \
M14_EXPECTED_ASAR_SHA256=<候选ASAR摘要> \
  /private/tmp/willyou-m14-stage6.WRvdST/g03/prep-next/a32-recheck/run-a32.sh attempt-<未用编号> git codex
```

目录可传 `git`、`svn`、`plain`。父可传 `codex` 或 `claude`。Claude 后台专项例为 `svn claude background`，本地业务专项为 `plain claude business`。前台矩阵与业务专项各自执行，业务安装未在离线预检中启动。当前预检只证明驱动和合成夹具形状，实际执行结果按尝试目录归账。[预检](preflight.log) · [驱动](a32-packaged.mjs) · [协议](protocol.mjs)


第一批打包记录见[072–074](../../../15be1a81e/A32-initial/README.md)。Claude 自己生成的后台完成通知和宿主排队真人输入分别判断。仅以最新用户信封里的原生系统标识与原 toolUseId 配对，暂挂的是原进程这一次纯文字模型回复。原 PID 仍活时核旧槽保持和子未开辟。其正常结果仍需实包复验。

## e17 后续矩阵

按下表的顺序从同一冻结源码执行，每条使用新数据根和新 App。当前只预检了夹具，正式通过以每轮实际证据为准。用于该批的源码应为 `e17b6c79e1c6470f44c730aca85c2f76d02efa9d`，ASAR 摘要由协调者在交接时提供。

| 尝试号 | 命令尾参数 | 待闭合判据 |
|---|---|---|
| 077 | `plain claude business` | 普通目录 Claude→Codex 的父继续写、待发子取消、子独占、原父续跑读真文件，加真实在途插件业务独立持有期和原 owner 排空顺序。 |
| 078 | `plain codex foreground` | 普通目录反向角色，交接、取消、父后续不抢槽及原生回读。 |
| 079 | `git claude foreground` | Git 共用目录余下的 Claude→Codex。 |
| 080 | `svn codex foreground` | SVN 余下的 Codex→Claude。 |

若 077 业务部分通过、父续跑等部分仍未通过，只归已证明的子判据，之后可用 `plain claude foreground` 补普通目录。e17 只给原生 CLI 增加带类型的待批准回执，MCP 保持 `awaiting_user`；本驱动使用实际 MCP 列出的原语。前一候选 [075–076](../../../15be1a81e/A32-recheck/README.md) 已分别闭合 Git Codex→Claude 和 SVN Claude→Codex，后者含真实原生后台活动。
