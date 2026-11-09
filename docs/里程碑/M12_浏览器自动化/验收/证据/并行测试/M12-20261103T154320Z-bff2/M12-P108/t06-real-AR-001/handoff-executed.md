T06 AR001实际交付，单次运行，不重发。App022/source026＋真实TaskService/Codex0.166/stockCLI/原内核身份/本机HTTP，模型是既有批准的loopback Responses合成模型，无OpenAI/实际auth/前台/UI动作。执行工具session89206，driver50240/App50246/HTTP57841；耗时9.831s。

原5负例按原命令顺序真实完成：projectId B→INVALID_INPUT、真实connectionId B→SCOPE_DENIED、approved:true→INVALID_INPUT、未声明update→SCOPE_DENIED、保留--project-id B→INVALID_INPUT。5个实际CLI均exit2；每步输出后的HTTP总数均2（只有setup A/B健康），业务增量0。B连接拒绝有真实failed/SCOPE_DENIED/read-only/attempt1账d85dc46e-b4f3-43e3-ac22-36a8ace56635/request189118f2-442b-49f2-88dd-ab8cd68436d5；其它拒绝没有operationId时不捏造。

最后同session literal合法A query实际exit0，HTTP总数才升到4：A的user与my/work两个GET，无B业务/无writeAttempt。真实成功op919a4419-d28b-4d43-a1cf-83b5f1b1ec0a/requestb17e9c51-2403-47b3-ac65-4628b6d922a5，与当前run a25abb87-e738-40e2-ac5b-67fea579242c/taskc2da2a8c-4b42-4a8d-bd4a-60b4256a69c7/project/package/Host/activity/attempt1/read-only/succeeded精确一致。V2source.connections/对象reference/activity/任务选用都唯一A，legacy transport列保持合同null。完整Skill树、实际full read先于拒绝、真实Native七调用、原defaultworkspace-write/on-request/noEnv overrides均重新核验。

原独立judge在decodeT06Outputs JSON.parse遇ChunkID而产生precheck红（decision0项，total占位6），原judgement.json/原源码/全部223输入/原raw保持不变。根因是该有限旧function输出的decoder故意保留完整metadata，而新case decoder误当纯JSON。派生只接受原实际的完整Chunk ID/Wall time/Process exited/Original token count/Output原字节前缀，核同call_id/source/行号/时间/顺序及真实numericexit；随后仅允许与expectedCode相同的一行willyou-app stderr诊断，剩余严格解析单JSON对象。不支持running/未知/缺exit，不泛搜JSON、不eval模型JS、不伪造0。exactcarrier新6真实正控＋10负控（错exit/unknown/running/多JSON/额外文字/错code/status/call/time/重复）全绿。派生precheck2/2、T06条件9/9，scope未变，原红完整保留。

真实App normal0/null，signals[]，cleanup/persistenceErrors[]；独立require_escalated verify-cleanup exit0：13PID/8TCP/2socket＋2directory共25checks allClear，真实Unix根在execution-result.json。已明确向Root释放全部资源，后续只文件派生。Root补充3个实际NodePTY physicalfile PIN启动前与运行后SHA/mode均完全相同，证据actual-nodepty-pins-before/after.json。原static manifest240和READY输入封存不修改；实际交付使用新delivery-manifest.json排除自身，raw/Native/实际runtime仅私有（safeForRepo=false）。

主要入口：execution-result.json、offline-adjudication-001/judgement-derived.json、finished-cli-text.mjs、t06-oracle-derived.mjs、check-finished.mjs、finished-controls.json、oracle.diff、原judgement.json与原raw.private.json。纯离线复核命令见下：
 WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t131-t06-scope-ar-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t131-t06-scope-ar-001/cache/node node /private/tmp/willyou-m12-t131-t06-scope-ar-001/offline-adjudication-001/judge-derived.mjs --judge
 WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t131-t06-scope-ar-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t131-t06-scope-ar-001/cache/node node /private/tmp/willyou-m12-t131-t06-scope-ar-001/offline-adjudication-001/check-finished.mjs

只建议Root复核原T06对应A/R子项，原I证据及T131其它8项独立维护；没有执行T38、不将准备或矩阵子项重复增加正式用例数。所有生产/公共账/原App22双轮稿未改。
