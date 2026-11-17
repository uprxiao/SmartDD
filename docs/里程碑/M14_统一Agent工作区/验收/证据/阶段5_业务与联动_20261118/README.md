# M14 阶段 5 开发证据（2026-11-18）

依据需求 R2.0、技术方案 T1.5、原型 P0.19、用例 A1.8；从阶段 4 提交 `b8189c15c` 接续。本目录是产品 U／I、原生沙箱探针和开发构建抽样验证，不是阶段 6 的全部打包验收。权威用例结果仍在[执行记录](../../执行与缺陷记录.md)。

## 实现与用例对应

| 用例范围 | 已落地的生产实现 | 验证入口与边界 |
| --- | --- | --- |
| A08–A10、A39、A40 | M13 交付到 SDK／app-server 的真实 run、冻结 Skill／MCP／CLI、项目 DB／SSH 上下文、环境最小化、资源保留、版本与能力门禁 | `task-capability-launcher.ts`、新增 Codex 1.6.0／Claude 1.4.0 适配器。保留旧适配器；未知版本降级并提示，不注入未验证业务交付。L0.skill／mcp／cli、L1 已登记；L2／L3 未验证，不宣称原生聊天输入已获得邮件发送授权 |
| A37、A72、A60 的业务请求部分 | 持久任务级请求；等待无执行超时且不占目录槽；批准前重验；批准时启动执行期限；停止／撤销退役；原生退出、切换、重启后保留等待；中断的已执行效果标未知、不重放 | `host-business-requests.ts`、`agent-business-tools.ts`。U／I 覆盖晚批准、停止、账号／内容变化、FIFO、真实执行排空和重启；开发 App 覆盖超过 60 秒后批准及两端结果唤醒 |
| A37 浏览器待绑定 | 原 owner 真实退出且无后继时，批准持久为待绑定；后继真实 PID 登记后重新校验并绑定；绑定前不告知权限可用；停止／撤销则作废 | `business-browser.ts`、`browser/access.ts`。待绑定、重启、撤销、目标页面变化有 U／I；真实跨任务浏览器打包组合留阶段 6 |
| A41、A72 | 邮件完整审阅、四种处理路径、手动修改另起修订并重新批准；Agent 修改按通知回原任务；发送始终需宿主批准；插件档位取任务、父任务及能力上限的较低值 | 复用 M13 邮件发送记录、连接版本、原文哈希及可信窗口审阅回执。真实 ToolService／SQLite 草稿与原运行退出后的受控执行有集成验证；真实 SMTP、账号和实际发信未执行 |
| A38、A42 | 文件路径／片段／批注／图片、应用结果引用、插件操作与语音进入同一任务草稿；原始身份与修订重验；引用不会自动发送 | 复用 M9 文件缓冲与 M13 来源合同。图片走附件原字节；应用引用不伪造 PTY；语音接既有 textarea 路径。系统语音／IME／剪贴板专项未执行 |
| A57、A58 | 固定 T3 识别器、消息原文与工作目录路由、行号／范围、修饰键、右键完整路径、任务内 HTTP(S) 浏览器 | `message-links.ts` 与 `src/shared/t3-links/`，来源／MIT 许可见 SOURCE、LICENSE 和 NOTICE。D2 不变：普通文件名及带空格的行内路径仍是文本 |
| A73 | 首页与任务页统一文件／网页／手动终端／差异面板、页签、最大化、快捷键、独立终端抽屉；子任务使用自己的工作副本与文件缓冲 | `workspace-panels.tsx`、`workspace-panels-store.ts`。U 覆盖面板边界；开发 App 实际打开文件、网页、只读差异和终端。系统快捷键、主题／窄窗口完整视觉仍待正式验收 |
| A65 | 后台 worker 的轮前／轮后树、Git 独立索引、普通／SVN 影子 Git、实际改动卡、分页／分段只读差异、预算／取消／恢复／保留清理 | `turn-diffs.ts`、`turn-diff-worker.ts`。真实临时 Git／普通／SVN 夹具覆盖 HEAD／用户索引不变、忽略、软链、取消、UTF-8 大差异；首次快照超时明确不完整，不能补造历史。无回滚入口；10 GiB 实际负载和跨平台性能未执行 |

所有业务执行仍经过原 M13 执行器、实际资源租约和操作账。延迟批准使用宿主限定的原请求作用域，旧 run 保持 stopped，不伪造活跃进程。执行租约必须等真实 producer 排空；停止或超时不会提前交出目录写入资格。

## 本轮测试

| 批次 | 结果 | 日志 |
| --- | --- | --- |
| M14 主回归与受影响界面 | 33 文件通过、3 文件条件跳过；308 项通过、6 项条件跳过 | [final-core14](logs/final-core14.log) |
| M13 邮件、运行交付、输入来源、ToolService 与私有桥 | 7 文件、400 项通过 | [m13-final1](logs/m13-final1.log) |
| 真实插件项目策略与浏览器授权服务回归 | 3 文件、68 项通过 | [plugin-browser17](logs/plugin-browser17.log) |
| 原运行退出后的真实内置草稿调用、未验证版本门禁 | 定向 2 项通过；同文件其余 80 项未选中，不计新增通过 | [final-native-scope16](logs/final-native-scope16.log) |
| 主进程／渲染进程类型检查 | 两项退出码均为 0，日志为空表示无诊断 | [node](logs/types-final-node17.log)、[web](logs/types-final-web18.log) |
| 开发构建 | `pnpm build` 通过，原生签名校验未跳过 | [build16](logs/build16.log)、[构建标识](build-hashes.json) |

各批次有重叠，不相加为唯一用例数。live 真实模型测试默认未启用；旧平台条件跳过不算通过。更早的定向绿测保留在 logs，失败保留在 failures。

## 最终开发 App

同一受验 build15，真实 Codex CLI 0.169.0、Claude Code CLI 2.1.326、SDK 0.3.321；模型响应来自隔离的本机合成服务。独立 HOME／userData／项目，后台 CDP Input 操作真实控件，不使用日常凭据，不发送外部邮件。

- [workspace-ui7](development-app/workspace-ui7/result.json)：真实原生命令改文件、每轮差异、HEAD／用户索引不变；消息链接打开文件／行号；文件缓冲在只读差异间切换保留，M9 自动保存仍生效；HTTP 链接打开任务浏览器；代码块粘贴后等成功回执和原生 PTY 回显，确认命令未执行，再经 UI 关闭终端。5 组断言并核对插件按钮单行布局、无渲染异常、正常退出 code 0。
- [business-ui6](development-app/business-ui6/result.json)：两端真实私有 MCP 都立即返回 awaiting_user，正常回合结束后请求仍在。Codex 等待 61,041 ms 后批准；两端均只保存一份冻结草稿，实际唤醒当前会话收到结果，排队清空。两组断言、无渲染异常、正常退出 code 0。
- [CLI 沙箱反向探针](m14-codex-cli-sandbox-negatives.json)：真实 Codex 内核沙箱可访问指定宿主 Unix socket；其他 Unix socket、TCP、工作区外写入被拒绝，工作区内写入可用。不等于真实模型自主调用或其他平台验证。

提交前仅去除 worker 文件末尾多余空行，补丁以 gzip 原样归档以保留 diff 上下文空格；随后 build16 的全部 168 个登记产物与受验 build15 逐字节相同，按哈希复用上述界面证据。

准确源码基线、依赖与文件哈希见 [source-baseline](source-baseline.json)，可恢复改动在 `source/`；证据哈希见 [manifest](manifest.json)。最终两个驱动在 drivers，执行前经过 node --check 与 CDP 字面表达式预检；动态模板另由实际流程验证。

## 失败与更正

失败目录及较早开发 App 结果保持原样，不能用最后一次成功抹掉之前的问题。

1. workspace-ui1 发现 Codex 首次打开 Git 项目会自然写 trust_level，被当成启动后配置篡改；同时拒绝的桥进程未登记到退出排空。已限制启动前的来源检查、保留每次操作的资源／账号／政策重验，并增加拒绝桥进程的精确身份清理。清理身份只用于退出核算，不授予业务权限。对应失败和回归保留。
2. workspace-ui2 的驱动误以为本来具有自动保存的 M9 编辑器不会写盘；只修正与既有合同不符的断言，保留“切换差异不能覆盖编辑缓冲”。workspace-ui3 未关闭手动 shell，退出确认未完成，该轮整体失败。
3. workspace-ui4、ui5 只等待终端出现就关闭，记录的 passed 不能证明粘贴成功；ui5 的 TERMINAL_TARGET_DENIED 是关闭早于异步粘贴所致。两轮保留在 failures，不能据它们宣称终端粘贴通过。ui6 增加实际回执、PTY 输出和未执行检查后通过；最终 ui7 还核对了插件按钮单行布局。GET favicon 被当模型 JSON 的夹具错误一并修正。截图复查发现插件数量按钮误用图标按钮的 28 px 固定宽度，文字竖排；已改文字宽度并在 ui7 检查实际布局。
4. business-ui1 将工具说明里的 awaiting_user 误当真实回执；ui2 合成模型反复提交同一业务而非等待通知，造成大量请求、退出失败。修正回执判别与模型状态机后，ui3／4／5 通过；ui4 起包含结果实际唤醒断言；最终 ui6 在 build15 复验。ui2 大结果压缩留存。
5. 部分首次 U／I 因未获本机 socket 权限、夹具未真正排空、测试读取错误 SQL 字段、或错误假设历史兼容夹具含最新版本而失败；日志原样保留。最终已以正确隔离夹具复验，不删除或修改生产边界来适配测试。

[失败 App 进程核对](m14-phase5-failed-app-process-check.json)按记录的 PID／出生身份确认本轮旧实例已退出，没有强杀日常实例。

## 复跑与交接边界

在依赖及原生测试资源已准备的工作区执行：

```sh
node scripts/run-tests.mjs src/main/core/agent src/renderer/features/agent-tasks
pnpm typecheck
pnpm build
node --check scripts/m14/workspace-smoke.mjs
node --check scripts/m14/business-smoke.mjs
node scripts/lib/check-cdp-expressions.mjs scripts/m14/workspace-smoke.mjs scripts/m14/business-smoke.mjs
node scripts/m14/workspace-smoke.mjs /private/tmp/m14-workspace-review
node scripts/m14/business-smoke.mjs /private/tmp/m14-business-review
```

两个 App 驱动串行运行，3425 端口占用即失败。开发开关默认关闭，未修改原型确认基线，未安装、推送或发布。阶段 6 的全部打包验收、真实模型组合、系统层、OpenCode ACP、旧代码清理均未执行。完整交接见[阶段 3–5 开发交接](../../../开发交接_阶段3-5_20261118.md)。
