T131 composition smoke：仅原证据只读派生复核，不新增App/模型/HTTP/SQL/OS动作；原raw和原judge5/6均不修改。

结论：S03误将CLI顶层传输connectionId与V2实际业务来源混用，属于oracle/schema错误。冻结source025/src/shared/application-cli.ts:4明确connectionId:z.null()；cli-gateway.ts:109–116先按该schema解析并原样将request.call交ToolService；tool-service.ts:172将call.connectionId原样记录application_invocations.connection_id。因此本次实际null符合CLI合同，不能把它本身解释成来源缺失或正确来源证明。

真实业务连接仍须严格证明：capability-execution.ts:82–90按required slots固定业务来源，:61用contexts.sourceRevisions产生source.connections；execution-context.ts:79从真实record.targets产生source revisions，:210–229核当前项目明确选用并以同operation写入application_data_operations.targets_json。zentao-data-service.ts:91–95使用该真实connection创建client，:123–136将同来源connectionId写入对象reference。activity-service.ts:22–25把invocations和同operation data targets联合，:60–66从targets/subjects/legacy列构成连接集合；单legacy列null与activity含A并不矛盾。

本次原始CLI输出在Native prefix第18行，call_id=t131_smoke_1；请求第15行，字面willyou-app zentao object list --kind bug。原JSONL逐byte prefix核相等，重新用原有限parser解析，未信cached normalized verdict。实际source.connections唯一zentao/A，identity/config/policy/binding revision均1；唯一对象79291标题T131 synthetic A，reference.connectionId=A且同identityRevision。完整Native输出没有B ID/名称。实际operation097b3ce9-8c23-41c9-abbb-0f0ffb97096d、requeste66a4277-1883-4dea-bfbb-8e6cc8fac8a6，与Host/read-only/succeeded/attempt1、activity agent-run和当前run/task/project/package精确相同。initial/final任务会话均唯一选用A；实际committed plan只证明当前actor/package/allowed CLI，不冒称它包含本不存在的连接字段。setup健康检查曾读B，但providerBaseline之后两个GET都A且无writeAttempt，唯一业务my/work为A，Bbusiness0。

原完整Skill目录/三hash/实际fullread先于CLI、原始session/currentplan/defaultpolicy、本次隐藏非输入前置、正常0/null/signals[]及原cleanup门槛均复用未改变的原判据重新计算；唯一被替换的是S03错误单列等式，新增严格V2来源链，见oracle.diff。独立派生smoke6/6，原5/6保留；不代表原T06五类越权或T38六类身份故障、双run/token隔离等完整矩阵已执行或通过，正式新增0。

纯数据21项（1实际正控＋20负控）通过：sourceB/null/empty/额外B、对象referenceB、legacy非nullA/B、错误Host run/task/project/request/op/package、重复Host、attempt2/write、activity错actor/来源、plan错run及postBaseline B HTTP全部拒绝。不是任何Native身份负例实测。source-hashes.json钉住217原执行输入和8个真实生产源（按source025manifest逐SHA相等），复核后原数据/输入全部SHA不变。

复核命令仅文件/纯逻辑：
 WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t131-composition-review-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t131-composition-review-001/cache/node node /private/tmp/willyou-m12-t131-composition-review-001/review.mjs

原cleanup已由Root独立24checks allClear；本次没有创建任何Native/App/监听/PTY/模型/认证资源，不重复OS查询。新App022双轮准备冻结保持不动。仅私有派生交付，公共生产/正式账未改。
