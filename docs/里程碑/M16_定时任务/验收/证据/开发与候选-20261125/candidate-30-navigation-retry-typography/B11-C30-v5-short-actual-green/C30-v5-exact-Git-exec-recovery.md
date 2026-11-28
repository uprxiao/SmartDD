# C30 B11.1 私有采样器 v5：已证 Git exec 过渡

## 实际失败没有改写

- 原 C29 K `run-K6VX0P`：`final-owned-identity-changed`，原 final CID/path 缺失，保持 fatal。正常 App 退出、有资源释放证据，不是 B11 通过。
- 原 C30 L `run-LKbruX`：实际端点 `diagnostic-post-command` #6；前5个原端点闭合。唯一漏项 PID 60997、birth 1795790941:390208、product parent 60201/birth 1795790908:316966、owned CID 18966。原两 UID census 和实时 net count 均34；已归属图33；原RSS无值。两次 BSD、CID、path 均成功，但 path 的实际哈希分别对应 `/usr/bin/git` 和 `/Applications/Xcode.app/Contents/Developer/usr/bin/git`。静态正规公开可执行文件及嵌入标识分别确认为 Apple Xcode tool shim [com.apple.dt.xcode_select.tool-shim-public] 与 Apple Git [com.apple.git]。parent 两次真实 family 均含该 PID。原 fresh probe `first-binding-not-confirmed` 未记录 errno，不能宣称 ESRCH 或自然退出。
- L 原 `scope-attempts.jsonl` SHA `f00e8d5cde3422c3a749610307285012cd049424ca428f6761970dc70fe69e0c`；原红明细 `run-LKbruX/independent-known-git-exec-gap-review.json` SHA `e5ad2486076d65d5dc9b018df5d1b24a5c1e75f19779cf71958f758eda0b9c4d`。

## 最小新私有行为

仅固定公开执行链一项、同一非 anchor PID/birth/UID/CID、同一带实际双 family 的已绑定产品父、两次成功完整 path 与固定 executable SHA、双完整 UID/counter 并仅一个已知 gap 时，判定**这个失败端点可重新取样**，不接纳该端点的任何 RSS。新端点仍需原全成员、全角色、图/双 UID/CID/真实计数闭合；同一父保持；原 PID 已完全脱离，或仍为同一 birth/准确后段 Git 正常受计；任何未知路径、不同 UID/CID/birth/parent、其他 unresolved gap、PID reused 均不放过。若后一次尝试已经有矛盾证据，立即 fatal；不能通过第三次把矛盾冲掉。原 3 attempts / 2s 与原 ESRCH 窄规则不改，全部角色和 RSS 区分不改，原 35+5 / 自然 1800秒 / 7组正式负载与阈值不改。

新 `final-owned-identity-changed` 原本缺失的 actual final BSD/CID/path return+hash 均留存；fresh omission probe 的精确失败字段也留存。未知身份仅记录相等性、errno和必要本轮已绑定摘要，不读取或曝光无关个人进程路径。未进行任何真实 App/Git/CLI 新执行。

## 静态证据

- 111 个历史真实闭合端点逐项原判词、角色/RSS 一致；原 L 只取得新规则重采资格，无真实后端点，原跑仍红。原 K/R5 保持 fatal，实际 R4 ESRCH原规则保持。
- 42 项回放（真实原始字段、分开标明 synthetic 的完整下一端点控制、实际 native capture 循环矛盾即停控制）；独立 JSON `git-exec-retry-replay-c30-v5-result.json` SHA `abeb98e79c3e214a9a377c72d8dfbc45daa8e34eb0b12fa01488d75ce984d1b0`。
- 26 项正式入口 gate 回放；旧 R6、C28 清理红、K/L 原红，都不能授权此版本。新旧两份真实工作负载及正式尾部字节一致。
- 包、150+源和相关原生固定资产按 `git-classification-preflight-c30-v5.json` 重新核验。短 freeze SHA `0a6ccf0968d59036803f936a4b5c529bb516c9e652e69db4d0d6e94975f99551`；正式 freeze SHA `5e294e359f732133c8aa4b89a0b98f49a354bcade0cad09cec7bcd52cccb6d19`。

## 仅供协调者执行，顺序不变

```sh
node release/m16-qa-support/b11-recovery/launch-git-classification-preflight-c30-v5.mjs --c30-git-classification-v5-approved
```

短必须新实际 10/10、44按现有短诊断 endpoint、完整当前资源范围、正常 App/driver 退出及原12秒 exact cleanup 全部完成。短不算性能通过。否则停，不盲重复。成功后协调者用实际新独立 run 根：

```sh
node release/m16-qa-support/b11-recovery/launch-formal-git-classification-c30-v5.mjs --c30-formal-git-classification-v5-approved --short-run <new-actual-run-absolute-path>
```

正式仍须满足原严格30min正式负载/界面/进程范围和统计阈值；正式任意未知/未闭合/异常须保留证据并停止。本文只说明验收驱动窄修，未修改产品、原公共合同、发布包或验收账。
