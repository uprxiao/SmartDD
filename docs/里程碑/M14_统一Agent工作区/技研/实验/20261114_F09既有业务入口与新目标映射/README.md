# F09 既有业务入口与统一任务映射

2026-11-14。**F09 研究关闭；产品代码、实际 UI 与业务执行未改。** 十五组入口、七十个源码文件已对应到 T0.1 §10.1.1 的服务／身份／目标／失败处理和 A 用例。新增两项实际模块检查；旧九项 UI／语音服务检查因源码变化重新构建复验通过。检查数量不增加 F／Q 总数。

## 决定

独立业务保留原服务：文件保存／查看器、浏览器页面／登录、项目 DB／SSH、配置加密导入导出继续原生命周期。PTY 绑定的引用／插件／语音入口增加程序化 task 草稿目标；不伪造终端，不在引用插入时执行 Agent。父子选择明确，换 Provider 不重建文件根、浏览器 profile 或业务凭据。

source prepare 与运行目标校验分开。文件／原业务模块验证 source，宿主发临时目标限定 token；新插入用 P1.2 draft.save 的 commandId／CAS，成功后保留来源描述对象与任务引用，执行仍走原业务批准和当前 run。源码中的 PluginUiActions 已能在没有 run／PTY 时准备原页面引用，真正 terminal proof／投递仍要求活运行；新路径应在此边界拆分，而不是删除原权限检查。

语音只有快捷键派发回执，不能设计成直接返回转写。新 composer 采用固定窗口暂存区，文本经用户确认后插入捕获的任务；切任务／目标失效不自动跟随，保留暂存文字供重选。旧 global OS 输入语义保留；不能承诺控制其他程序输入。新实际焦点、IME 和暂存交互仍须产品 A42／52 验收。

引用描述复用 C1.5 context object，draft／submission block 中的 contentHash 指向描述；描述绑定 token／task／revision，旧 live proof 不持久化为权限。草稿引用、准备读租约和描述依赖内容加入 F10 既定完整 retention 查询；没有新增冻结项或另起关系版本。

## 本批实际检查

| 检查 | 结果与边界 |
| --- | --- |
| E01 共享引用 formatter | 六种引用 file／range／comment／PDF／DOCX／PPTX 的正文与位置可保留；终端 framing 独立，不能进入新草稿。原选区截断有明确标记；相对路径身份不能从显示文本反推。不是文件授权或图片传输测试 |
| E02 PluginUiActions | 以合成原读 receipt／政策 callback 准备引用，未提供 run／PTY；错误窗口、来源变化、释放／过期拒绝；修改返回副本不改宿主来源。留下的文字不等于仍有效的动作 proof；未调用实际插件或 draft.save |
| UIE01–09 当前重验 | 当前 TasksStore／auto-resume／VoiceService 在替身 IPC／导航／文件关闭／Typeless 环境下运行。认证存在且 preview 未变化的旧任务仍 open；缺认证、归档、缺原能力、sourceChanged／model.changed 不自动打开；保存失败保留正在打开的视图；语音旧 schema／PTY 限制、取消／失焦复核和 shortcut-sent 语义保持 |

[两项结果](result.json)、[九项结果](current-ui-result.json)。UIE 的 agentSnapshot 仅为明确的存在标记夹具，preview／凭据均未真实验证；没有 OS 快捷键、录音、原生进程、网络、邮件、DB 或 SSH 操作。新草稿事务继续复用 F01 与原同步实验，完整 IPC／预算归 F16，资源回收归 F10。

## 首次失败与证据时效

E01 最初错误预期“相对文件名含换行会拒绝”。实际 validateReferencePath 允许该文件名，formatter 保留换行；该失败修正的是实验假设，没有修改产品解析器。最终断言保留换行并验证路径穿越拒绝；设计改为使用结构化 ref、显示转义文件名，不从 prompt 解析身份。

旧 UIE 构建比对发现 tasks-store 和 app-settings 两个输入变化。原夹具没有 agentSnapshot，因此首次当前重跑在自动启动反例断言失败：当前主路径已保护无认证来源的旧任务。补明确的认证存在／preview 替身，同时验证缺失和变化拒绝后，原九项通过；旧“任意 ptyId=null 会自动 open”的表述缩为有合法旧恢复条件的反例。新程序化分派仍必要。失败 probe／结果与成功记录均归档，不覆盖旧实验。

旧 U01–U07 构建的 100 个输入及配置加密 T01–T04 的 243 个输入与当前一致，直接复用其边界证据，没有重做文件选择／加密往返。旧 UIE 的 113 个输入中两个变化已由当前重建同样 113 个输入复验。新 formatter／PluginUiActions bundle 有 107 个输入。详见[来源审计](source-audit.json)；来源数量不是功能通过数。

T3 本地 composerContextReferences 将引用编辑留在 composer，composerDispatch 单独决定实际派发；这只作为分层参考，不声称 T3 有 WillYou 的 Office、项目凭据或插件业务。参考修订仍为 f313d0a6cb843551fb60e57a454a71e71a3a8c04，SmartDD 为 5a9e04382441e24624cb94635f9d902c543a03d7。

[归档](evidence.tar.gz)／[摘要](archive-manifest.json)含实际来源、bundle、脚本、首败及最终结果；不含用户数据和真实凭据。正式迁移接线、UI 操作、真实 DB／SSH／语音和安装包没有执行。Q38／42 的研究判据在源码、已有及补充实验、具体设计与 A38／42 用例上关闭；Q43／52 仍有 F16 缺口，不能写成新 UI 已完成。
