# P020 / T086 attempt002 定向复验与联合交付

最终独立联合判定15/15通过，originalT086Passed=true。原T086完整I使用上一不可变attempt已通过的viewport/device/offline/headers六项，加本attempt实际geo与media复验，以及本轮环境/清理/输入核验。motion-only reduce与空参数clear是两项补充，不增加唯一用例数。

本轮唯一实际业务 2026-11-04T03:55:13.164Z 至 2026-11-04T03:55:25.686Z，12次真实CLI，只执行缺失geo及受影响media，没有重跑旧绿矩阵。准确命令：

```sh
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p020-executor-001/attempt-002/cache node /private/tmp/willyou-m12-p020-executor-001/attempt-002/run.mjs --execute
```

| 实际新执行 | 结果 |
| --- | --- |
| geo 显示前置 | 本次自有inactive宿主挂明确pageId的原生view，仅I显示前置，不请求系统焦点、不修改默认Agent tab激活行为；读取准确目标pageId，实际visibility=visible。 |
| geo 用户前置与回调 | 真实CLI配置1.2345/2.3456/accuracy12，页面实际navigator请求产生单一geolocation prompt，准确目标快照和prompt ID匹配；经真实permissions.respond仅一次显式I用户允许，实际坐标回调{"accuracy":12,"latitude":1.2345,"longitude":2.3456,"phase":"success"}，随后prompt为空。没有Browser.grantPermissions、handler替换、硬件/App A声称。 |
| media dark+reduce | 实际dark=true/reduced=true。 |
| media light+no-preference | 实际dark=false/reduced=false。 |
| media motion-only reduce | 实际dark=false/reduced=true。 |
| media empty clear | 实际dark=false/reduced=false。 |

复用依据：旧manifest9ead3826b29a5fc2cc00764de34478fbd6b99b3f4601d3956e27960f3c2c4f44共336文件逐项SHA二次核对；fixed .4 helper7a009d32及所有依赖/运行资源不变。生产page-commands.ts在不变set device行之后至不变clipboard read分支之前，仅media块/对应注释改动，剔除该精确块后其余全文逐字节一致，见unchanged-branch-proof.json；其他生产源码沿原冻结清单，只有明确三文件补充。6项旧业务判据的原始实际数据在result.json复用条目中逐项引用，不把本轮未执行写成新跑通过。旧geo夹具观察错误、desktop visualWidth误限初判和media产品红均保留原attempt，不回写历史。

输入：原1814清单8f9ef6159e0c74219abd73f232380259ca20a1ab6500cb6fed7933b0fc1d051c＋独立3文件补充f561ffc1faf0c6656c6e4236cac2f04a003c1165a07af7afaae3b7634b3c9850。compiled-hostc878cbc4af6a663cb4110de0063d0aef106d365de77a0955e6ca559dd9e55eac，279实际源快照、215依赖源哈希、旧112私有依赖和272运行资源按SHA复用，3原生执行件0755/X_OK保持。准备只在私有副本bundle，不打包App、不读活动src。

本轮host60067 exit0，20个实际自有PID（含helper daemon60116）逐项ps/lsof无残留，54141/54148两数字端口无监听；helper stopped/clientStopped/socketFilesRemoved均成立。被测页面/Session和viewport/geo/media emulation随真实dispose销毁、代理和helper断开、App退出。cleanup.json可复核，原生资源已交还协调者。

原生前置修正没有业务重放：preparation-failure-001.json记录独立branch proof只删旧单行而新实现为多行，改为严格剔除完整media块再比较；preparation-failure-002.json记录复制到已存在的同目标node_modules只读symlink时拒绝，改为过滤该symlink并复用。两次都未启动App/业务，未改共享依赖或生产。

结论范围是原T086技术I，不代表真实硬件、系统用户授权或App A。整体原始CLI、目标页状态、独立judge、源与资源SHA、旧复用manifest及清场共同支持通过；脚本exit0未被当业务结论。
