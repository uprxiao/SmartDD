T121 静态执行稿已实现，未执行 R，正式新增 0，资源持有 []。

唯一范围为原 M12-T121 / R08.2、R08.5：真实 Codex 处理本机合成 Bug，缺陷实际不存在；会话给出环境、版本、账号、步骤、20.00 实际结果和真实证据路径的未复现说明；模拟禅道没有任何写请求。来源原文及工程证据拆在 contract-t121.json。新 payload 自身要求先完整读取相关 Skill，作为本次 payload fidelity 单列，不把它改写成唯一需求的额外业务条款。

包为 App021（ASAR 7b63bb817a9047656f4fe268fae4a4ea20d2f17b472c6dce417dccad837d0fd6），冻结 source025（manifest fc0804c493320514f4938d76755c6d0bdc9aa42adb41c30813ffedafaa74b6c9）。固定真实 Codex0.166、原生CLI、Helper6b、browser/M10 Skill均按 pin.json / skill-package-pins.json；本轮未启动它们或读取实际认证。复用 G1-005 setup/一次reload/真实Home启动/默认workspace-write和on-request；fake-only synthetic M10 connection cipher限本次私有userData，恢复原函数及调用计数，不是OS Keychain验收。

静态和纯控已实际执行：check-t121.mjs 24项，check-carriers.mjs 6项，check-preflight.mjs 7项；真实冻结harness label正负控、所有当前脚本语法、Node CheckJS未绑定名、6条字面CDP表达式和3个实际生成表达式已检查。其他动态类型诊断保留 semantic-diagnostics.json，不能称全项目types绿。新Unix清场表达式首轮转义错误在Native前被拦，原错/哈希保留 preparation-failures.json；修后纯检查绿。未执行本机HTTP监听预检，纯handler输入/输出控制代替不了实际运行。

真正未来命令（只有Root记录本次确切新发送批准、独占租约并给用户新前台条件后才可执行）：

    WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t121-sop-static-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t121-sop-static-001/cache/node node /private/tmp/willyou-m12-t121-sop-static-001/run.mjs --execute --authorization /private/tmp/willyou-m12-t121-sop-static-001/authorization.receipt.json --lease /private/tmp/willyou-m12-t121-sop-static-001/lease.receipt.json

只发一个新T121 prompt（payload-review.json，SHA da8722c70fffd6225eda1037811d969e587368b94b7a83f17d4c22c4aeac2757），不是旧G1/T043授权范围。authorization.template / lease.template 保持NOT-authorized / NOT-granted，没有实际receipt。用户睡觉，本轮不询问、不发送。

需要一次新实例首次前台：所有RPC项目/健康前置完成、一次reload后，只读等本次 exact PID/exe/userData Native+DOM visible连续3s（最多300s），然后一次fresh guard；不自动激活/不重arm。模型turn最多600s，整driver看门狗18min，真实未知写不重发。固定本机43327端口冲突即失败，无fallback URL/新请求。未来独占边界：本次App/受管PTY/本机HTTP1个/CLI和本页Helper/OS只读清场，无日常App或真实禅道。

独立判定路径：实际task/run committed plan + 完整owned Skill目录（template目录SHA、rendered目录聚合、实际读取单SKILL文件SHA分清）；重新解析原始Native JSONL并与最终原文件prefix逐字相等；全部同call_id/顺序/有限AST；实际M10 list/detail/正文+历史fullresource/附件为空事实；当前run Host operation和完整activity；真实 browser snapshot/只读NativeDOM为qa、fixture-fixed和20.00；原生click及站点真实认证XHR；截图和HAR等文件真实路径/mode/bytes/hash/格式；console/network可按生产返回inline或artifact，不强迫所有小结果都是file。Browser合法write要求completed，read要求read-only，M10仍全GET/HEAD且任何被405拒绝的写尝试也不允许。

密码仅允许实际CLI标准输入：已支持精确snapshot密码ref + --stdin value原CLI session → 仅一次本fixture输入 → 同session真实终态fill/Host回执。输入匹配仅私下布尔、不发布值或密码hash；cmd/argv/诊断/最终说明中不得明文密码。持续会话缺exit_code仅在已声明且同session/相同有界输出形状下记ongoing、exit=null，最终必须有真实终态；若只转发完整CLI结果而numeric exit未观察，保留null并由精确当前Host成功账证明业务完成，不伪造进程exit0，正常退出/清场另核。受控Python从资源读取后pipe等尚未出现的载体不被当提权或产品红，也不能泛放行：若实际出现且当前有限AST不能严格归因，保留原raw为unverified/partial，由离线有限补证复核，不杀正常模型、不重发。不得为让旧parser通过改变SOP/提示/审批。

未来运行正常退出后，单独核真实自有资源：

    WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t121-sop-static-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t121-sop-static-001/cache/node node /private/tmp/willyou-m12-t121-sop-static-001/verify-cleanup.mjs --verify
    WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t121-sop-static-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t121-sop-static-001/cache/node node /private/tmp/willyou-m12-t121-sop-static-001/judge.mjs --judge

cleanup只核已保存PID/birth/executable、数字端口、实际捕获CLI和private-broker socket/dir、逐页Helper .pid/.sock/.stream，惰性.version不作为运行残留；不杀未知PID。正常App exit0/null、observedProcess.signals=[]与测试清场分别判，强杀不能冒充正常退出。Driver每步独立finally落盘。资源结束即释放，之后才整理交付。

运行时 raw.private.json / Native JSONL /实际Skill/private日志/userData均仅本机私有，不入公共证据或prompt；未来入库只适当safe metadata，不能把全部运行目录纳manifest。当前 manifest只静态合成材料，无auth/旧started/raw/live。旧G1参考、未跑分支、不确定载体与实际产品结果严格分开；T120/123/124/125不在本组。
