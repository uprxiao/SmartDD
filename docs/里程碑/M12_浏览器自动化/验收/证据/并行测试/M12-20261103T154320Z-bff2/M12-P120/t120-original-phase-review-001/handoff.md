# T120 原完成阶段复核

仅复核 App022 原已完成的 T120 phase0；原 judgement 4/12、12 个 unknown 记录与原 raw 保持不变。有限派生复核 12/12，供协调者独立归账；T125 未发送，不合并为双轮通过。

- 25 个真实 outer call/output 对、55 个工具参数由纯 AST 静态绑定；仅62→66截断的只读工具目录元数据保留 unverified，不用于任何 Skill/业务成功证明。
- 3 个相关 Skill 的完整原字节在16→22读完，早于24→30首次实际 tab list。目录/文件哈希各按原交付字段区分。
- 29 条唯一原 Host 完整行均当前 project/task/run/package、attempt1；原 requestId、operationId、读写 effectState、原调用前后时间窗全部一致。
- Bug详情完整、正文352B/历史96B均 offset0/eof=true/nextOffset=null；附件列表为空。早期 INVALID_INPUT 保留，不冒充成功读取。
- 原 helper 与 literal Add/Update 逐字链、105项源快照和实际文件一致。密码来自完整正文，仅传 subprocess input，真实原 snapshot 密码 ref、--stdin value 和 Host fill 对应；不执行该 helper。OS argv 未额外观测，仅由实际源和调用重建。
- 同环境 URL、fixture-v1、qa；点击原计算引用一次后20.01，截图/console/network/capture start/stop五回执与Host均成功；原文件和链接实存字节核对，诊断敏感值仅内存布尔扫描。
- 实际 assistant final 本身含 URL/环境/版本/qa/步骤/20.01及20.00对照和5条真实证据链接，没有用报告文件替代会话字段。
- 原 App normal0/null、signals=[]；原独立cleanup113全清。此次仅文件读取、纯AST/JSON，没有 App/Native/SQL/HTTP/model/OS 资源，resourcesHeld=[]。

复核器自身初报目录为空与一次私有诊断嵌套过滤错误在 analysis-corrections.json 如实保留。任何原密码值、单独密码hash、原Native/工具结果、原helper/原artifact、缓存、auth和审批receipt均不纳交付。

可独立纯文件重放（不运行模型代码；原始数据须仍在原执行根）：

```sh
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t120-original-phase-review-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t120-original-phase-review-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t120-original-phase-review-001/inventory.mjs
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t120-original-phase-review-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t120-original-phase-review-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t120-original-phase-review-001/extract-finite.mjs
python3 /private/tmp/willyou-m12-t120-original-phase-review-001/review.py
```

`parsed-original.private.json`、`finite-extracted.private.json`仅本机派生中间结果，不归安全manifest。原数据与源码只读；以上重放仅覆盖本 review 的派生输出。
