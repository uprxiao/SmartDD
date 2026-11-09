# 原 T123＋T124 真实 R/A 组合

App025/source029；完整原合同在 original-contract.json，统一发送审阅在 payload-review.json。原 R 层级明示由真实 UI 启动 Codex，因此 T124 也保留 UI 启动。两条当前无可复用的实际 R/A；仅复用 T120/T121 的合成 Bug/站点、M10 只读服务、真实 Skill/plan/Native 和隔离收尾驱动，以及成功 T004/T125 的单次发送消费/ACK流程。原 T131 位置不动。

同一 App、独立 P123/P124、一次 AI profile 自动 health、全部项目/连接/选择准备后一次 reload、一次真实初始 Native+DOM 稳定焦点、一个不可重新武装的 guard。T124 先做：另一真实 UI 任务由 Agent 登录项目默认 qa 作非受验前置；主真实 R 读取 qa2 Bug，自己建任务独立 profile 并标准输入登录；原另一任务在原项目 profile 真实 snapshot 确认仍 qa。T123 随后：实际无密码工单/未登录页→Agent告知需登录→可信 UI 暂停→真实 Agent 单次 snapshot 收到 BROWSER_PAUSED 不重试→暂停期间同原生页可信 Input 登录 qa→可信 UI 恢复→同任务/Native/run/page/profile真实继续。没有暂停/登录 RPC、DOM 值或 SQL 代替动作。

P123/P124 在 reload 前分别建立并完成连接和 AI 健康；项目默认浏览器 profile 按产品原规则由 Agent 首次打开页面建立，随后对实际 owner/ID/partition 作只读核对。T123 的默认 profile 必须与 P124 不同；其初始实际 Native 页必须显示登录表单、无账号、无先前登录 POST。两个端口共享 127.0.0.1 不作为 Cookie 隔离依据。

6 条固定业务提示、2 份完整合成 Bug/历史、qa/qa2 演示账户、本机固定 URL/方法、4 份公开 Skill 模板、CLI/私有页面/证据路径范围及唯一产品 health 模板均在统一 review。health 原参数为 ephemeral/read-only/no tools；业务保持 workspace-write/on-request，不加策略覆盖或永久批准；单次真实 on-request 请求另记 approvalRequests 并等待真实审批，不能据此自报批准。Root 应一次绑定具体完整发送授权及实际工具审批；不宣称已有用户逐字确认这些新提示，也不预设必须逐提示新问。只允许未来已授 lease 后从本轮 owned T120 CODEX_HOME 复制 auth.json 到新独立缓存；不读/输出/哈希单独认证，不复制旧 config/Skill/catalog/env/history；新 config 仅当前 model/provider/policy/两目录 trust。

预期暂停错误另走 paused-proof.mjs，绝不走 success-only typed-primary。复用原 T113 两份真实 snapshot 输出：exit 2、BROWSER_PAUSED、provider/read-only、attempt1、不可重试，绑定实际 operation/request；源029 read 调用语义相符。10/10 纯文件控制含两真实正控。未来该阶段在完整原 Native/Host 保存后核同 thread/turn/cwd/run/task/project/package/plan、唯一失败 Host 和 no retry；不把 exit2改0。stderr 固定提示与 JSON 的 Native 合并仅有限两行解析，不从任意文本捞成功。未知载体和原 parser 结果均私有保留，Root 完整离线审核后才能接受 R；直接 typed 只能补其已证明的子集，不能替代 stdin/资源/完整安全审核。

准备期间只运行纯文件语法、公开包哈希/CLI身份读取和原保存错误格式控制；没有 App/Native/HTTP/UI/模型或认证读复制。执行前仍需 Root 审阅并写 authorization.receipt.json 和完整 lease.receipt.json；模板不构成批准。固定端口占用即停止，不换未审 URL。未取得/途中丢失焦点就保存原经过并正常清场，本次准确 PID 首次激活仅在已授权的前置阶段执行一次；运行中不再激活、不重武装、不重发。

Root 未来在完整租约下执行一次：

```sh
env WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t123-t124-real-R-004/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t123-t124-real-R-004/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t123-t124-real-R-004/run.mjs --execute
```

驱动正常收尾后先独立清场，再原判据文件判断：

```sh
env WILLYOU_M12_NATIVE_LEASE_CONFIRMED=1 NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t123-t124-real-R-004/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t123-t124-real-R-004/cleanup.mjs --verify
```

```sh
env NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t123-t124-real-R-004/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t123-t124-real-R-004/judge.mjs
```

所有实际判据目前未执行，正式新增 0。后续安全归档不含 auth/DB/全 Native/完整终端/私有账号配额截图/runtime；只安全投影与原件 SHA。

R002 仅追加已获用户明确授权的准确 PID 首次激活：实际 call_7fa2b9ae68354542a7dcf11b953aeea9/0，原脚本 SHA481e2888fa1a4c8e24aa47ae44613ff1ab2ad94b780f3e508f984b91521b8d96。健康和一次 reload 后、原 stable3s/guard 前一次调用；之后原 focus guard 不变。Root 已阅读全文并按现有用户测试目标授权本完整 payload 和 owned CLI 登录复用；授权回执说明其真实来源，没有编造用户逐字批准新提示。仅待 Root 新资源租约及其既定只读非 loginwindow 前台核查，不新增用户逐条确认。原 payload 内的 R001 私有路径示意字节为保持 c205 哈希未改，Root 明确指定的本次实际隔离前缀是 R002，固定提示和发送内容/目的地不变，详见 preparation-amendment.json。

R003仅在三处原followup的共用入口接入T105 A007已真实10/10验证的terminal-rate-menu/helper与私有逐样本落盘，helper逐字节复用。状态按实际Native session保存并核task/PTY，每个Native最多一次临时Keep current model；第二次同类菜单不再操作，完整留证。未知弹层不发键。原sender/原empty composer判据/六提示和health payload c205/原judge/初次准确PID激活/stable3s/guard/paused预期错误分支不变。T123/T124原实际业务仍未执行；这次复用的是已证明的驱动能力，不把T105结果计为两条新R。Root已审完整payload并授权在本目标范围执行和CLI登录复用，on-request真实工具审批仍保留；无新全局配置/模型切换/永久选项或凭据读取。

R003原model-turn的5秒资源观察同时只读保存当前准确终端完整private样本；识别到实际审批标题+选中菜单时live标记awaiting-Root-single-onrequest-tool-approval并仅通知Root，等待其本次临时审批，不自报批准、不发送审批键、不选永久批准、不因该提示立即关App。原600秒完成等待与租约/异常收尾边界保留；原样terminal descriptor/读错误和安全hash均先落盘，Root可在live阶段检查，不依赖另一个未出现的用户答复。

R004当前变更：只在T124两个需要密码的固定提示中明确tty:true工具会话、stty -echo、cat管道到browser fill --stdin value、一次write_stdin password+LF+单Ctrl-D、退出后恢复echo；禁止密码进shell/argv/临时脚本/env赋值或改走find/actionfill。T123三提示和无密码可信UI路径、只读peer-confirm、6阶段业务/原judge/paused错误分支/保密门槛/parser/helper均保持。ROOT/title为R004；旧R003/c205授权和失败仅在lineage引用，新payload-review.json确实为新SHA，待Root全文审阅后按同一原用户全验收目标/CLI复用/合成本机publicdata→OpenAI范围签新authorization.receipt.json，再授完整资源；authorization.template不是批准，permit原门闩不变。

直接transport实证：[P132 local stdin transport](/Users/liubu/hx/4.uprxiao/SmartDD/docs/里程碑/M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P132/local-stdin-transport-001/manifest.json)，SHA49568644f8795fb8e57dbd34ab3170937293083cfe83c5224f5387bc0e522d23。Root实际session32733管道读到nonTTY/原24Bexact/单尾换行trim且无echo，shell正常exit0；此仅transport，不是Host/CLI/App/model业务通过。真实CLI source029 native/applications/cli.mm58拒TTY、60去一行尾换行，原journal64仅接受fill--stdinvalue的单次secret+LF+CtrlD，均未修改。
