# 最小预检与未闭合项（未执行）

只静态准备，当前无 Native/App/PTY/编译/OS 采样租约。此目录不是新包长跑READY；源022/App019最终PIN仍由协调者提供。无需重跑002六控或原已绿矩阵。

## 先使用已有证据

- P079002的Mach单位、live→WNOWAIT→wait4计入时机、hidden leaf、两级rollup已实测；原13/13及独立frontier勘误保持。
- 002的重父daemon terminal漏项负控保留，不通过重跑求一个更长zombie窗口。
- 原003自己的own CPU 58.9856%仍是明确红，不重新计算成新绿；未观测短进程只可能使它低报。原curve/raw/analyze不修改。

## 尚需最小Native门槛（一个受控短组，不是30分钟）

1. **直接子项清单语义**：在同一受控P→C中对live、waitid WNOWAIT确认的terminated-unreaped、真正wait4后分别记录proc_listchildpids。要实测返回单位/有效长度/截断行为；API存在不等于会列zombie。保留原live birth、rusage startAbstime与父子WNOWAIT；BSD不可读不删除子项。
2. **final cut竞争**：只变夹具时序，使列表中的leaf在API读前被parent真正wait；按children先、parent-counter后读取，与wait4交叉，证明具体遗漏项由后置parent累计覆盖；不能把任何errno3都当reaped。再让leaf在cut前出生但到final scan仍未reap，必须从inventory取全量，不能等下个5秒碰运气。
3. **反例必须拒绝**：截断列表、unknown birth、root exit、counter rollback、终止orphan、final读失败、未完成wait/来源不明的child，纯数据判定都应incomplete。已有002 orphan trace可用，不必再造一个Native orphan。

本Native gate不启动App/窗口/HTTP/PTY，不连接调试端口，不申请taskport/ptrace/ES或新系统权限。若现有同UID API不给完整child inventory/最终cut证明，就停在coverage gap，不推进“上界<5通过”。更高采样频率或重复等到安静不能代替这个门槛。

## App019最小代表门槛（等最终包及租约）

沿用原T111前置，仅5tasks/5pages和5warm真实snapshot。在clock0前形成完整anchor manifest（实际App metrics、真实run/PTY/receiver、每页私有daemon PID文件/会话/源码/binary PIN、OS birth+startAbstime），以真实接收/回收事件证明warm结束。

- 固定5daemon建立在warm后，clock0到最终cut每个身份必须持续同birth；任何bootstrap/reconnect/timeout、原CLI结果/attempt异常、pid文件缺失/换代直接failclosed，不换root继续收费求绿。
- 五个receiver只处理固定调度，不新增任意子命令；每条真CLI communicate已回收，宿主auth/execFile响应完成。只读现有观察通道不得冒充所有异步child已结束。
- final cut在原测量结束后，收齐所有已发命令与回收回执，做已验证的family scan、post-counter闭合；保存所有尝试与误差窗口。未知native子进程或无法归属的orphan应明确缺口，不能因为metrics集合稳定而跳过。

## 长跑接入保持项

只在上述门槛闭合后接OS补充collector。原5秒own/RSS流、0/5/10/15/20/25/30分钟、35正式+5warm、完整1800秒、活动区间、全部idle峰值和原5%一核阈值不改。补充rusage写新jsonl与独立upper判定；原idle分母按既有分析器原载体/哈希读取。upper>=5只说明未能证明，不自动说真正CPU失败；lower>5则仍明确失败。

## 当前尚未证明，必须列明

- proc_listchildpids能否完整列出未reap zombie，以及返回长度/并发fork/reap的闭合条件。
- final parent-counter与枚举失败之间的回收顺序保证；002只证明明确wait4返回后的结果，没有证明任意并发errno3都已归并。
- Electron/Chromium库内部额外短命进程、Helper socket异常bootstrap是否能全部以现有低权限证据排除或计量；Rust snapshot主路径静态无launch并非整个依赖树不fork的证明。
- “全部基线root同birth”只证明这些root没退出；它不证明额外隐藏orphan不存在。
- 外部collector实际CPU/读窗口影响、新包actual ABI/PIN、全scope proof artifacts尚未形成，不能因算术模型测试绿写成App验收绿。
