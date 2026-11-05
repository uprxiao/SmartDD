G1 attempt002 READY（修复实际RunPlan合同），2026-11-05T10:50:00.663727+00:00。旧attempt001不动。

已授权payload-review.json逐字保持d128380e3629b69a8f996b37ceb18d70be7c8014d88c67aa1ddd785a2176fb3e，三个prompt/两个Bug/marker/固定随机端口均不变；不用重新render、不再问同一授权。根迁移原specific确认receipt至新根即可，代码仍要求同payload/hash/marker/目的地/userMessageReference。

App021/source025 PIN冻结actual ASAR7b63…及sourcefc08…，io.verifyPin同时断言这些当前合同常量，不再硬编码旧App019或误当App020；实际P102构建/六smoke0为gate。

P104共享plan-reader.mjs按b0d09c5a5d74e8e3bd5f4db76fd42b397c1b925ea9b0eba725f8d6e441265ccd原字节复制；UI applications.session.currentRun.runPlan只作verified/cliVersion/effectiveEntry摘要，poll等verified而非.skills。row.actualPlan由实际own-App SQLite committed operation读取；actual-plan.mjs另保存真实3-query readonly原record并canonical逐字比对。离线judge-core再次verifyPlanRecord(row.planRecord,expectedRun/task/project)、owner/currentStore/committed/planHash验证，再用其full skills/allowed判原生journal。没有拼fakeplan或把UI摘要覆盖为fullplan。

真实初始手势采用实际A4成功路径：setupreload后fresh nonce/timeOrigin注册trusted pointerdown观察；在任何脚本Input前，必须真实pointerdown count>0＋Native/DOM连续1秒，移除observer留userGesture，才装一次原guard。只给这段人工握手5min，不改模型240s等业务超时；没有自动app.focus或optionalhook，lease.initialFocusHook必须null。

28项纯数据控通过，包含实际R007完整record2Skills/82allowed及task/project/owner/commit/hash/UI-summary负控、三臂原判据；23模块语法检查通过，显式私有cache。所有Models/App/Native/监听/认证读取均0，正式新增0。本组仅静态准备，真实Model及现场手势/原生journal仍未执行。T122必须两臂齐；T126仅browser-only臂，不能宣称整条通过。

根先给exclusive Native/UI/PTY lease和已授权specific receipt：
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-sop-real-static-002/attempt-002/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-sop-real-static-002/attempt-002/cache/node node /private/tmp/willyou-m12-sop-real-static-002/attempt-002/run.mjs --execute --authorization /private/tmp/willyou-m12-sop-real-static-002/attempt-002/authorization.receipt.json --lease /private/tmp/willyou-m12-sop-real-static-002/attempt-002/lease.receipt.json
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-sop-real-static-002/attempt-002/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-sop-real-static-002/attempt-002/cache/node node /private/tmp/willyou-m12-sop-real-static-002/attempt-002/judge.mjs --judge

当前prepared报告是静态；不按退出码判R。完整结束后root独立审原始自然语言问题、实际DB record/journal/日志与正常退出清场，才归账。原R007/R008失败由根保留，本attempt不冒充修复后实际通过。P103已另交ready，本根不运行或干扰它。
