# 程序化运行连接与邮件业务联合验证

日期：2026-11-14。D01／D04，承接 §4.102–105。最终 attempt-2XwvPm 的 B01／B02 两项通过。当前源码的程序化研究扩展与真实 Codex、默认 v2 私有 MCP、现有邮件业务服务已在同库串联；未修改产品代码，不计正式产品验收。

## 范围和基线

SmartDD `5a9e04382441e24624cb94635f9d902c543a03d7`；实际服务 bundle 681 项输入，候选 684 项输入。候选使用当前 session／run／plan 的三个最小研究变体、共享原生身份 claim；默认分发字节精确复用 §4.102，并重新核对资源源码摘要。构建 manifest 的 scope 沿用旧文案，候选确有三个变体，以 source-review 的勘误和补丁摘要为准。

固定 Codex 0.167.1 启动两个实际 app-server，分别启动私有桥；宿主核验真实 PID／出生身份／祖先关系。使用实际 ApplicationService、当前授权、连接选用、草稿、意图、发件身份、展示回执、发送授权和执行服务。Prepared binding／来源引用为研究夹具；renderer／cipher 为替身，通过服务调用模拟审阅及批准，模型由回环服务生成。SMTP 仅用本机夹具核验连接，发送 submit 为受控返回，没有真实邮件 DATA 或供应商模型调用。

## 两项联合检查

| 检查 | 结果 |
| --- | --- |
| B01 本次绑定与当前选用分离 | 能力历史记录 Z；启动时捕获 A；运行中项目切为 B，原生 MCP 实际发送准备和执行仍使用 A。受控 submit 一次，原 intent 重放返回同一 execution 不重复提交。启动计划字节不变；停用后缓存工具调用返回 APP_NOT_ENABLED 并进入后续模型请求 |
| B02 明确后继运行 | 确认旧 CLI 与桥退出、run stopped 后启动 generation 2，真实 thread/resume 保留同 task／binding／native ID，捕获当前 B，走新草稿／intent／模拟 UI 审阅授权后从 B 受控提交一次。重新启用后的发件身份需要新确认，不能复用旧修订确认 |

最终共十次本机模型请求，协议账两个 initialize、一个 thread/start、一个 thread/resume、两个 turn/start。两 Codex 和两桥均重新核验内核状态 stopped；两 run stopped、39 份租约 released，完整性及外键检查通过。三次回环认证、两次受控 submit、零 DATA。

## 失败及修正

七次尝试全部保留，不能只取最终成功。最早 QRUPTI 被清理查询缺列覆盖了原错误，主因未知；随后 B555VN 明确为监听 EPERM。6CivRj 复现研究入口漏传 bindingMode，修正在临时变体。eSdlJ8 是本机模型判读不认识工具文本前缀；BPhlWk 是漏等桥退出导致准入正确拒绝；lPKzDK 是重新启用后漏做新修订的发件身份确认，实际业务正确拒绝。后两项修正调用时序和前置，没有放宽权限或改预期让旧批准生效。

审计七份库均通过完整性／外键检查，无活动 run 或未释放租约；所有已记录的六个 Codex 和六个桥身份重新核验 stopped。最早无主因的尝试只保留 state.sqlite，其余包含 final.sqlite。旧失败的脚本、变体和构建摘要保留，早期被覆盖的完整 bundle 不宣称已归档。

## 设计结论与未验项

程序化入口必须显式承接原 bindingMode／bindings；宿主捕获本次运行配置，Driver 不自行读取项目最新连接代替。固定连接不会冻结当前开关、连接有效性或业务批准。结束后重新运行可捕获新连接，历史、运行与项目当前选用分别保留。应用停用再启用可能改变连接槽修订，按现有规则重新确认。

原生进程 exit 不等于桥及所有业务活动均结束；本轮只联合验证已认证桥的排空，不能代替完整后代或独立邮件在途活动证明。继续复用既有业务服务，不让 SDK 自行绕过它们。

同 Provider 续聊已串联，但跨 Provider 邮件、委派、原生真人输入来源、完整业务结果准入、迁移复制恢复、异常宿主、浏览器 run-bound 和其他版本／平台仍未覆盖。真实 UI 与正式产品用例仍未执行；研究通过不增加宽口径问题的完整关闭数。

复现：使用固定依赖运行 patch.py、build.mjs、build.mjs --candidate、probe.mjs、audit.mjs；需要归档指定的 Codex 和 macOS 内核 helper，以及 §4.102 同摘要默认分发。仅启用隔离回环服务，不需要真实凭据。见[结果](result.json)、[来源与逐次审计](source-review.json)、[原始证据](raw-evidence.tar.gz)、[摘要清单](archive-manifest.json)。
