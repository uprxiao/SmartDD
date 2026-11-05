# M12 G1 真实 UI/R 可执行代码交接（静态准备，未执行）

时间：2026-11-05T09:09:45.635025+00:00。新私有 attempt：`/private/tmp/willyou-m12-sop-real-static-002/attempt-001`。001 原交付未改。本次完成真实执行代码及独立原生 journal 判定器，不只是执行计划。**未运行 run.mjs／judge.mjs，未读账号／登录态，未启 App、原生 CLI、PTY、监听、网络、模型或系统输入；正式新增通过 0；不持有任何资源。**

## 直接审阅入口

- `run.mjs`：真实 App020/source024 PIN；新 payload 授权＋root Native/UI/PTY 租约通过后才会读既有最小认证 seed。两个独立本机合成 M10 连接、三个独立项目／任务，全量前置及真实 profile health 完成后只 reload 一次；随后初始 Native+DOM 连续 1 秒，才装一次不可重武装 guard。
- 三任务均用 `[data-testid=home-project]`、`home-profile`、`home-input`、`home-launch` 的真实 UI 创建与启动；不调用 tasks.create/start，不替模型制造业务调用。项目、连接及选用属于本用例不被验收的前置数据，通过实际宿主接口准备；实际固定组合由 RunPlan／交付文件和真实调用验证。
- `native-journal.mjs`：重新读取本次原生 JSONL；元数据 cwd／0.166.0／原生 session 绑定；typed function_call/output 按同一个 call_id 配对；递归解析原生工具包装中的**全部**实际 app v2 receipt，按实际 RunPlan 的 capability／包 hash／CLI 入口校验，未沿用旧 R006 三能力白名单。实际当前渲染 SOP／禅道 Skill 的完整同 call 输出先于业务调用，不能以片段／自报／命令回显代替。
- `judge-core.mjs`、`judge.mjs`：独立重读最终 journal、保存的实际交付 Skill 字节、磁盘 HTTP 日志，核真实 host task/run/request 绑定、本人列表→同来源详情→完整分块正文，以及提问／不猜地址／不选冲突环境／零环境导航／零禅道写请求。发现任意部分／缺项保持失败或部分。自然语言问题仍由 root 阅读原文复核，代码输出只称 evidence-pass-needs-coordinator-review。
- `payload-review.json`：三条准确提示词、两条完整合成 Bug、全部拟交付公共 Skill／参考文档，以及发送数据及排除项。SHA256：`d128380e3629b69a8f996b37ceb18d70be7c8014d88c67aa1ddd785a2176fb3e`。Marker：`M12_SOP_d8a2be8555030546`；预选随机 localhost 端口：`[31781, 38289, 39727]`；如已占用立即失败，不暗改已审阅 payload。T122 missing 的内部 `scenario.siteOrigin` 仅供夹具管理，**不放进模型 prompt 或缺失 Bug 正文**。

## 判据与边界

1. T122 缺失、冲突两臂分开读取不同本人列表中的合成 Bug；两臂全部满足才给 root 一条 T122 的候选证据。原要求“不猜地址、不打开任何环境”保留，不能只用最终询问文本掩盖之前已导航。
2. T126 本轮只交仅浏览器项目的真实 I+R 臂：实际没有禅道包／调用入口，实际交付 SOP 引导请用户提供环境与账号，真实 Agent 读取并询问。**不宣称整条 T126 通过**；原双项目组合要求仍在合同里。T122 两项目虽同时选了禅道与浏览器，其证据可交 root 审阅复用，但本判定器不自动把它折算整条 T126。
3. M10 为 R08.5 明确允许的本机合成只读服务；没有合成模型服务。模型为真实 OpenAI/ChatGPT `gpt-6.1-sol`，标准 workspace-write／on-request，参数空列表，CLI 及来源非秘密配置 SHA 与 R006 冻结元数据一致才继续。
4. 合成工单带 qa / Qa-Pass-1，属于非秘密演示数据，会进入模型上下文；真实账号／token／auth 文件／日常数据／T127 不在范围。原生原始日志和瞬时工具输出全部保持私有，归档前要脱敏，不把本 attempt 的未来 runtime 入公开证据。
5. 初始前台**尚未在本组实测**。`initial-focus-hook.interface.mjs` 只是 wait-only 接口。root 可把其已验证的一次 exact-own App 操作写到新的私有模块，并在租约里给 path/SHA/reviewedByRoot/oneShot；驱动只调用一次，再独立核 Native+DOM 1 秒。没有 hook 时只等待真实前台；失败就退出，不自动激活日常 App、不重武装 guard。
6. 实际 App020 M10 路由兼容、真实 UI 控件／原生 journal 格式和模型行为尚未经本组运行验证；首次运行里的测试连接、RunPlan、交付哈希及判定会 fail closed 揭示差异。本静态自检不冒充 R 成果。

## 静态自检（均未执行实际驱动）

- `check-static.mjs`：24 项内存正负控制通过，包括三臂完整合成阳性轨迹、旧授权拒绝、错误 hash／来源／call_id／包／task/run／原生 session／沙箱拒绝，完整 Skill／分块正文缺项拒绝，打开环境、猜 URL、禅道拒绝的写尝试、仅 DONE 文本、T122 单臂、T126 单项目均不能冒充整条。
- `check-driver.mjs`：9 个 literal、5 个 own-body 语法；3 个 Native 主进程调用均有 label；校验授权在认证／CLI／App 之前、真实 UI 启动、exact PID/exe/userData、一次 hook 与连续 1 秒条件。
- `syntax-check.json`：20 个本组模块全部 node --check 通过；表达式仅编译未执行。
- 两次静态控制自身错误（测试 fixture 漏 connectionId、静态 checker 未识别 shorthand label）已留原分类记录并修正；未改业务预期，无实际产品红测。

## 后续准确命令（只有 root 在新增授权及资源就绪后执行）

先由 root 根据新的实际用户确认填写 `authorization.receipt.json`（status=explicitly-authorized，scope=M12-G1-T122-T126-browser-only，payloadSha256 为上述 SHA，marker 为上述 marker，destination=openai/gpt-6.1-sol，实际 userMessageReference）。旧 T041/T042 确认无效。模板默认状态不能通过。

再由 root 领取 Native/UI/PTY，填写 `lease.receipt.json` 的真实 grant、起止 UTC 和本私有根／准确 App20 可执行路径；如有已核实 focus hook，填写其真实 path/SHA 及 oneShot。不得把模板自报为已授权。

```sh
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-sop-real-static-002/attempt-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-sop-real-static-002/attempt-001/cache/node node /private/tmp/willyou-m12-sop-real-static-002/attempt-001/run.mjs --execute --authorization /private/tmp/willyou-m12-sop-real-static-002/attempt-001/authorization.receipt.json --lease /private/tmp/willyou-m12-sop-real-static-002/attempt-001/lease.receipt.json
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-sop-real-static-002/attempt-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-sop-real-static-002/attempt-001/cache/node node /private/tmp/willyou-m12-sop-real-static-002/attempt-001/judge.mjs --judge
```

第一个命令有界运行，三个模型 turn 各至多 240 秒、初始焦点至多 120 秒、整批 18 分钟 watchdog。判定依实际输出与独立 judge，不依脚本退出码。若第一次执行失败，保留原 raw／失败分类，使用新 attempt 记录修正／复跑，不能删除 execution-started 重放掩盖失败。

未来 runtime 输出：`raw.private.json`、`runtime-001/`、`judgement.json`、`live.json`；各原始 journal、电子日志、stdin／cookie 原文保持私有。清场仅本次 task／App／监听，正常退出单独核查，未知进程不碰。静态交付 `cleanup.json` 不会被未来执行覆盖，真实清场写 `runtime-001/cleanup.actual.json`。
