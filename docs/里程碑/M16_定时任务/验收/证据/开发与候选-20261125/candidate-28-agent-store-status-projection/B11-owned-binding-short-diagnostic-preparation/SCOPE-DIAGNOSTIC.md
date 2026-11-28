# B11 C28：R5 原始 fatal 保留，短诊断准备（非性能验收）

## 原始证据与限制

R5 第10分钟真实后采样（private run-QsHCN9）是 `identity-raced-after-owned-binding` PID93936。原始 attempt 两侧精确 UID/CID census 都是35，且同一 PID/birth `1795768399:309501` 同状态；直接产品父 PID86795 两次完整真实 child inventory 都包含它，实际图只有34，coalition starts 3054→3055 / exits 3019→3020，净35→35。原 collector 的 exact_row 同一个 gap 分支同时覆盖二次 BSD 失败或 birth 变化、CID 查询非法或不一致、二次路径失败或 hash 变化。它只留下 kind/PID，缺原返回值，推出“已退出”是不成立的。

历史 C22 同种真实 fatal（B11-XPC-identity-green-Git-churn）当时已识别准确本组 Xcode Git，但仍没有有效后采。后来 C22 真正可重采的是另一种明确 `candidate-all-esrch`，C27 完整18端点无此 bare gap。不能把它们当成本次缺失的二次 native 返回。

因此 R5 原判断仍 fatal，正式 B11 未完成；原始 R4/R5 及 C22/C27 全保留。不开新的1800秒正式长测，不放宽 closure_contract.py 的任何分类或统计阈值。

## 仅补实际失配细节

独立 `own_scope_native_diagnostic.py` 是原 R5 collector 最小副本；`scope_mismatch_diagnostics.py` 只消费**原本已取到**的返回，不调用任何 native API。原 first BSD/UID/CID 绑定、调用顺序、raw gap kind 和后续纯判据不变。新增：

- 原 first 与 second BSD 返回字节/errno、PID/UID/birth/父匹配；只在同一已证 birth 内保留该 own birth/父信息。
- 首/二 CID 的 native 返回长度、errno、valid/等于本组判断、时间与本组 CID（外国 CID 数值不保存）。
- 原 path 和 second path 各自是否真的读取、rc/errno/返回及 SHA256；不保留未知明文路径；对未绑定二次身份不额外读取 path。
- usage rc/errno/start/exit，RSS 异常是 NoSuchProcess 还是 AccessDenied；真实直接已证父 birth/role/CID 和原 child inventory 是否包含本 PID。原完整 after UID/CID/父表判据照旧。

由此可以区分准确的同 birth/CID exec 路径过渡、ESRCH、拒绝/权限、PID 更替、其他 CID 等各种情况，但**仅供真实后续采证**；所有现在的 unknown/raced 依旧 fatal，不做重采扩大。待实际返回和新的完整闭合证据再单独判断是否有严格可重取的真实模式。

## 可选的独立短诊断

仅在协调者明确释放当前 B08/B09 UI、3425 及 B11 资源后可执行；此次准备没有启动：

```sh
node release/m16-qa-support/b11-recovery/launch-scope-diagnostic.mjs --diagnostic-approved
```

独立 launcher/wrapper 强制新 diagnosticOnly lease、精确 C28 bundle/current native/原官方 0.169.0 CLI pins、正常原产品能力入口与 loopback 私有 fixture。复用原5个独立真实任务页面、停放、5次暖机、真实同组 detached probe 增减闭合及严格独立身份。协调器只有真实 preflight 完整才允许专属 diagnostic gate（不能发正式 continue-1800s）。

其后最多5次**原样**普通固定 `willyou-app browser snapshot --page <own page>` 业务命令（每个页一次），每次前后走同一个原生2秒/3尝试采样合同。最后最多30个正常 idle 诊断观测，最多12秒预算，不新增业务命令或造进程流量来制造失败。任何 fatal/未闭合立即停后续业务并保存实际 raw。最终正常退出、独立清场；另外对实际同组 UID/CID census 所见但未成为有效RSS节点的已证 birth 也只进行清理核对，不给 product 角色。

报告明确 `formalEligible:false`，没有30分钟指标、趋势比值、CPU判断或任何 B11.1 pass。即使短诊断未触发 mismatch，也不能据此声称已修复/正式通过。

## 离线预检

```sh
PYTHONDONTWRITEBYTECODE=1 /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 \
 release/m16-qa-support/b11-recovery/scope-diagnostic-preflight.py
```

`scope-diagnostic-preflight.json` 原R4/R5/C22/C27 hash与实际endpoint抽查、C27 18/18、C22 18/18、R4原5/5、R5原9/9 已有效RSS/闭合结果不变；原 C22 ESRCH 后真实闭合仍有效；R5 bare gap 仍 fatal。用实际原/新 collector 函数做隔离纯输入控制（不查询进程，明确非历史真实返回），验证相同 native 调用序列、same birth/CID path hash变化、二次 ESRCH、外国 CID/UID/parent、EACCES 差异、原已有 ESRCH 分支和 RSS 异常；未知仍 fatal、无明文未知路径。所有正式 R5 文件 pin 未变。Python AST、Node 语法、CDP literal 及仅 clang syntax-only 检查均执行。
