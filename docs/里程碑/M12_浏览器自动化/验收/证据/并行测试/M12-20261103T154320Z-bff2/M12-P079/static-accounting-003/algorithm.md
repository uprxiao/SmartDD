# T111 全范围 CPU：优先采用保守上界，静态方案

本目录没有 Native/OS/编译/App/PTY 执行，不改原 T111003、P079001/002 或生产源。upper_bound.py 是可执行的纯数据计量核心，不是已经接入的 OS sampler；所有范围证明缺一项便拒绝完整通过。模型测试是合成算术负控，不是新的 Native/App 证据。

## 实际限定拓扑与来源边界

原 T111 三次资料核对（原 run.mjs/receiver.py、source020 包装层、冻结6b内核）给出的执行路径：

- WillYou 主进程维持其 Renderer/GPU/Network/Utility、5 个真实 PTY 中的长期 Python receiver；5 页各有一个 kernel daemon。原样本是20个已观测长期身份，其中5 daemon的PPID=1；这只是历史实际观测，不能把20当未来包固定数量或证明没有别的短进程。
- receiver.py 的唯一工作是阻塞stdin，匹配本轮35正式+5warm调度后 Popen 真 willyou-app browser snapshot --page，并 communicate 回收；没有再fork子树或执行任意输入。其健康探针在clock0前完成。
- 原生 willyou-app 自身是Unix通信客户端，不启动子进程；App的MacUnixPeerIdentityReader为实际CLI鉴权spawn身份helper，等待close；MacProcessIdentityReader身份读使用同步execFileSync。App的BrowserHelper为snapshot执行一个短batch client并等待原execFile回调。
- 冻结6b main/connection确认每条客户端先ensure_daemon；已有同版本socket就复用，否则可setsid启动真正daemon。该启动是唯一已找到的本路径脱离原父树边界，不能假定每条已复用；新启动/失联/版本变化必须判测量gap。
- 6b snapshot→take_snapshot只走CDP/AX读取；指定本页CDP的connect_cdp_inner将browser_process=None，沿实际socket连接，不调用launch_chrome。install/upgrade/provider/stream录制等其它spawn分支不是这次argv可达路径。冻结源拷贝本身不证明binary可重建，因此需同时绑定原官方build日志、实际SOURCE、recipe与固定binary SHA。

仍未闭合：Electron/Chromium内部其它短进程行为、final未reap inventory是否完整、动态socket失效造成的隐藏daemon bootstrap等，不能因应用层源码未见spawn就自动判不存在。下方gate必须给真实证据，否则模型明确incomplete。

## 为什么固定 daemon 可作为保留root

同一原生PID+BSD出生身份+rusage startAbstime在clock0、全部原5秒样本、最终cut均保持一致，且counter单调、exitAbstime=0，可证明这个身份没有中途退出又复活。每个daemon的私有pid文件必须始终唯一并与该身份一致，5个pageId/session/socket归属不变。任何缺失、读失败、PID或birth变化、counter倒退、重连/重启/timeout/CLI失败，均阻止CPU完整通过；不自动替换新root继续计通过。

这只能保护这5个固定身份，不证明没有额外隐藏orphan。其它基线owned identities也按保留anchor处理；未来App019实际基线应按metrics/真实PTY run/Helper文件与OS归属闭合，不能硬编码旧20个PID。计量器不读取令牌、argv/env或日常profile。

## 可执行的保守累计

每个确认owned birth保留 own 与 reapedchildren 组件的单调最大值；观察到子项死亡或被父回收时不扣旧信用。祖先的child counter之后再次包含它，允许重复收费。完全在两次采样间完成的短leaf若已由持续anchor真正wait，则其全部CPU由anchor的child累计覆盖，不需先看到leaf PID。

优先为证明简洁，使用这些私有新进程的**整个生命周期累计量**，不扣clock0的启动/warm，也不扣命令忙时；不是用启动基线矫正CPU。即：

    U_raw = sum_birth [max observed own_raw + max observed reaped_child_raw]
    U_seconds = U_raw * mach_timebase_numer / mach_timebase_denom / 1e9
    CPU_upper = 100 * U_seconds / 原分析器原样计算的完整 idleEligibleSeconds

原idle分母、实际活动窗口和全部5秒峰值仍保留；分子还收费warm、busy与历史重复项，只会偏大。严格比较原<5%，不除逻辑核数、不滤掉高值、不改权威原始lowerbound。若原observed own已>5，仍确定失败；若U>=5但own<5，只能说上界未证明，不能说真正CPU一定超标。

只要下面覆盖前提全部成立，测量期间每一CPU片段至少被某个max信用覆盖，重复项均非负，因此U>=真正idle owned CPU。没有这些覆盖前提，U只是候选数值，不得凭“sum一直涨”称上界。模型 formalFullScopeApproved 恒false，由协调者复核实际证明后再接入正式判定。

## final cut 与不漏条件（关键）

测量1800秒/原最后采样结束之后，停止本轮合成receiver的新调度，等已经发出的实际CLI communicate和原宿主响应完成。可复用原有只读getAppMetrics回执作为主线程同步身份helper已返回的顺序证据，但不新增调试端口/hook，也不把它当成所有异步子进程都结束。

随后使用同UID公共libproc：对每个保留anchor做direct-child inventory，读取每个存活/未reap子项的v1/v2；BSD不可读的zombie依旧用真实父子inventory+原startAbstime维护身份，不能报不存在。先children/read，后anchor累计last-read：

1. pre-cut前已经wait的隐藏leaf由最后anchor child累计覆盖。
2. pre-cut仍活着或未reap的leaf必须进入真实完整inventory，其完整own/child信用计入，即使之后parent再收费也不扣。
3. enumerated leaf在自身API读取前被wait掉，只可在真实parent回收/最后累计覆盖已证明的条件下交给anchor；不能把任何API errno3都解释成wait，脱离父树或身份不明就gap。
4. inventory两次或generation/counter bracket表明有并发fork/reap时，保存所有读数/尝试，进行短有界补扫直到覆盖闭合；这不是删CPU样本，原CPU与峰值全部保留，额外工作全部计入U。无法闭合即failclosed。
5. 若某个pre-cut orphan不在任何保留root的回收累计中，也未取得真正terminal counter，就必须gap；即使是已有partial credit也不能说已计完整。P079002已实际证明这种terminal窗口可仅约11.6ms，5秒轮询不可保证。

这不是目前已验证的final inventory实现：SDK只有proc_listchildpids声明，是否含终止未reap、列表/读失败和wait更新的竞态须最小Native gate确认。SDK还明确NOTE_TRACK/NOTE_TRACKERR/NOTE_CHILD自10.5不支持，NOTE_FORK事件不传child PID；不能用它们假称完整fork跟踪。无需新root/ptrace/taskport/ES权限；若现有同UID API无法封闭，就如实保留缺口，不扩大特权或换门槛。
