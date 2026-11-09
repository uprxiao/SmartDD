# M12 T120–T126 SOP 真实模型验收静态准备

交付时间：2026-11-05T08:29:31.821955+00:00。本轮只读文档／冻结源码，并写本私有根；没有启动 App、原生工具、PTY、监听、网络或模型，没有读取登录态／真实禅道／日常项目。**正式新增通过 0。** 不持有 Native/UI/构建资源。

## 已核清

- 需求 R1.3 R08.5 与原用例明确允许本机 F-SITE、合成 F-BUG（M10 只读本地模拟服务）。T120–T126 不需要真实禅道账号；T127 完全不纳入。
- 七条原用例全文在 `contract.json`；每条全部原子判据列清，T122 双臂、T126 I+R 双项目没有合并掉。源码／需求／技术／用例来源均复制并带 SHA，见 `sources.json`。
- T123 仍必须用户暂停、手动登录、恢复，并实际观察 BROWSER_PAUSED 后无重试。脚本登录只能准备其他用例，不能替代本条。
- T125 承接 T120 的实际 profile，必须真实 Agent 修复隔离本机源码、自己重启服务，再同样步骤取新证据。夹具切 fixed 标志不能代替。服务 runtime.json 时间不是 OS 出生身份，root 运行时仍要核准 PID+birth+exe+cwd。
- `payload-review.json` 有 9 个准确新提示词模板／具体静态示例和 6 份完整 Bug 示例、全部发送数据及排除项。明确含非秘密演示密码 qa / Qa-Pass-1、qa2 / Qa2-Pass-1（T120 原判据要求正文给密码）；T123 Bug 不含密码。外部目的地为现有 OpenAI/ChatGPT `gpt-6.1-sol`。此新范围**尚未授权／未发送**；T041/T042 同意不能复用为 SOP 同意。

## 可直接复用的静态材料

- `prompts.mjs`：纯文本渲染器，限定本次 marker/title；新的明确授权收据缺失或不匹配时 fail closed。
- `fixtures.mjs`：无 import 启动副作用的 F-BUG/F-SITE，M10 `/biz/api.php/v1/user`、`/v1/langs`、`/v2/my/work` 本人范围分页、`/v1/bugs/<id>`；拒绝所有 M10 写请求。登录页、账号页头、总价错误／修复页与 console/network 效果均可由真实浏览器操作。日志不记密码、Cookie 或 token。
- `project-template/`：T120→T125 本机总价缺陷源码及未来服务入口，**从未执行**。root 后续复制 fixtures.mjs 到同一隔离项目，并写本次 scenario.json；T121 用独立已修复计算源码。签名 Cookie 可跨同源服务重启继续使用，便于按原 profile 复验。
- `check-static.mjs`：12 项纯数据／内存 handler 控制，已通过；包括缺失 URL 不泄漏、冲突双地址、无密码、本人分页、只读拒写、授权门闩、登录与重建 handler 的同 Cookie 复验、日志无敏感值。它们只证明夹具和渲染器，不是 R 层验收。
- `execution-plan.json`：最小组 G1 为 T122 双臂＋T126 仅浏览器臂；继而 G2 T121＋T126 同时选用臂；G3 T120→T125；G4 T124；G5 用户 T123。无人工登录的组优先。
- `judge-contract.json`、`operations-and-cleanup.json`：每条独立原始信号、证据字段、负向控制、真实 UI 前置与清场顺序。

## 仍待 root 完成，不能宣称整批可立即执行 R

本交付没有重写完整 App UI 编排，也没有实现完整原生 journal→SOP 独立判定适配。`/private/tmp/willyou-m12-t041-t042-real-codex-006` 可复用 PIN／真实终端 UI／一次 reload 后初始焦点／本次原生 journal 架构，但其 parser 只收三条 browser capability、完成 marker 只认 T041/T042、Skill proof 只核 browser 固定段落，**不能原样用于本批**。必须按 `judge-contract.json` 扩展全部实际 browser/ZenTao receipt 和多 Skill 完整读取证据，再做负控。

实际 App020 当前禅道包版本／hash、模拟服务路由兼容性、两个项目实际交付的 RunPlan/渲染 SOP，仍须 root 在资源可用时复核。本次仅源模板及 renderSkillTemplate 的静态查阅；模板包含两种条件说明，不据此认定两项目的真实交付与调用已经通过。不得根据旧 `work_list` 业务术语给模型硬塞过时 CLI；让真实 Agent 读当前 ZenTao Skill 的实际入口。

下一步最小动作：root 审阅 payload，补当前 R006 parser/多 Skill proof 和 G1 编排，取得新范围发送确认及 Native 调度后运行 G1。T123 留到用户在线；T127 继续后置。所有原用例仍按权威账逐条收口，不因本准备增加通过数。
