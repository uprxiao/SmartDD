# F36 / BE08 五页资源趋势技术探针（预备驱动）

**证据级别：独立合成夹具实验。** 不启动生产 WillYou，不连接日常实例、不用现有账号／项目／数据、不进行外部浏览器操作；不是正式 M12-T111，也不是 F36 产品端到端验收。不在本目录开发生产架构。

## 运行协议

| 项 | 两组共用配置 |
| --- | --- |
| Electron | 固定 42.11.14，冻结基线 `a0acddb3a` 的本地依赖；启动器保留二进制、驱动及分析程序哈希，运行时核版本 |
| 壳与页面 | 同一规格从未 `show` 的 `BaseWindow`，1 个壳 `WebContentsView` + 5 个固定本地文件页（440×300 CSS px），页在壳之后；`backgroundThrottling:false`，相同安全 webPreferences，日志及各独立路径显式设置 |
| 策略 keep | 5 页在空闲均保持 `View.getVisible() === true`（可绘制，不等于系统可见） |
| 策略 idle | 5 页在空闲均 `setVisible(false)`，逐页仅在固定交互／截图时按需 `setVisible(true)`，完成立即恢复隐藏；不销毁或重载页面 |
| 初始 | 两组均创建五页并各做一次相同暖身操作；随后才应用策略，并相同静置 1 秒；不把暖身计入 30 分钟 |
| 检查点 | **short** 0、5、10、15、20、25、30 秒；**long** 0、5、10、15、20、25、30 分钟。依单调时钟绝对计划时间，不累计 sleep 造成漂移 |
| 交互 | 检查点先读取固定页面的 100ms 间隔定时器及页面身份，再将该页恢复可绘制；只在该页作用域临时 focus emulation，固定 CDP 坐标点击一次，观察计数 +1，截 PNG，核对页身份和计数未重置，清除模拟焦点、detach debugger，恢复该策略本来状态。空闲时不执行页面脚本 |
| 截图独立校验 | 暖身及每个检查点均保存 PNG，五页共 40 张；按钮点击切换交替红／绿色块。离线校验哈希、几何、25 个固定区域像素，避免旧截图、误指壳或黑图被误认为成功 |
| 资源样本 | 长实验间隔 5 秒、短实验 1 秒，另存各检查点操作前后；`app.getAppMetrics()` 原始完整关联进程数据，并通过主 PID 与 6 个 WC 的 OS PID 对照验证覆盖；空闲采样仅查询主进程 API／原生拓扑，不接页面 debugger 或调用页面脚本。保留调度偏差、跳过采样及原因 |
| 操作边界 | 固定本地 `file:` 夹具；禁 background networking，并拦截试验 session 的 HTTP/HTTPS 请求（只记被拦截次数）；不建立远程调试端口，不注册外部工具键，不请求用户数据。不激活、聚焦、移动或操作系统窗口。每个策略启动一次新进程、全新私有 HOME、userData、sessionData、日志、临时目录；不使用现有 App 数据 |
| 清场 | 正常操作完成后先清除自建 debugger 并显式关闭 6 个 WC 与宿主；验证本进程窗口与 WC 数为 0，再结束进程。父启动器只观察自己创建的新进程组；到上限仍未退出可终止／强制终止确切本次子进程，回执明确标失败，不操作其他 App |

## 由协调者统一运行（执行者未启动 Electron）

先运行两组短实验，核对所有回执、两个策略真实 `View.getVisible()` 状态、PNG 像素和统计完整性；任一异常停在技术探针回执定位，不把失败当架构稳定。确认短实验可用再执行两组长实验，建议连续串行、记录机器负载条件；长实验实际等待各约 30 分钟，不通过修改时钟／缩短间隔来代替。固定一次成对趋势只用于探索，需要归因时另作重复试验并交替策略顺序。

```sh
python3 /private/tmp/willyou-f36-resource-dj9dcf8r/run.py --electron /private/tmp/willyou-f36-lab-tljocnfp/baseline/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --mode keep --length short
python3 /private/tmp/willyou-f36-resource-dj9dcf8r/run.py --electron /private/tmp/willyou-f36-lab-tljocnfp/baseline/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --mode idle --length short
```

两次命令各自输出 `BE08_RESOURCE_RUN=/private/tmp/willyou-f36-resource-run-...`。用各自实际目录作为对比输入，长试验只将 `--length short` 替换成 `--length long`。需要重新离线计算已有证据而不重启时：

```text
python3 /private/tmp/willyou-f36-resource-dj9dcf8r/analyze.py <实际试验根>
python3 /private/tmp/willyou-f36-resource-dj9dcf8r/compare.py <keep实际根> <idle实际根>
```

退出码 0 仅表示自定义合成实验的取证完整性通过，并非性能指标达标。保留完整原始数据；若 `probeEvidenceComplete=false`，读 `errors`、`driverFailureEvents`、`fixedFixtureOperationReceipts`、`idleCPU.gaps` 及日志，不对缺失项插值。

## 输出与口径

* `manifest.json`、`launch.json`、`run-result.json`：执行命令、二进制与驱动哈希、运行身份、进程退出／回收结果。
* `raw.jsonl`：完整原始操作、计时、原始 Electron 每个进程 (`pid, creationTime, type, memory, cpu`)、检查点和拓扑事件证据；每个事件立即落盘。`screenshots/`、`stdout.log`、`stderr.log`：原始独立证据。
* `resource-points.json`：每一个资源点汇总，保留原始时间、进程构成、覆盖状态。`summary.json`：操作/PNG结果、timer Hz、恢复/点击/截图时长（逐项原始耗时在 `raw.jsonl`）、所有检查点总 working set、CPU累计差及覆盖缺口、清场判定。`compare.py` 校对相同试验方案与文件哈希后输出同一检查点的两策略比较，明确不能把不完整结果用于性能结论。
* 内存为每个 Electron 关联进程的 `memory.workingSetSize` 原值汇总（KiB，可能重复计入共享页），不是去重后物理内存占用。要求主进程及所有已知 WC 的 OS PID 被指标包含，PID 去重，记录 creationTime；不把主 PID 单独作为 App 总资源，也不把这一范围冒充整个系统或真实 WillYou 的执行器/PTY/CLI/外部辅助进程。对可能脱离进程组且未被 Electron 关联指标报告的辅助进程不作完整覆盖声明。
* CPU 优先 `cumulativeCPUUsage`（Electron 固定版本 typings：进程自启动累计 CPU 秒）。稳定 `(PID, creationTime)` 的相邻空闲资源样本做累积差／墙钟秒，按持续时间汇总，得到占单个逻辑 CPU 百分比（不默认为全机器百分比）；排除操作中的检查点前→后间隔。进程集合变化、CPU累计缺失/回退、资源覆盖异常保留缺口，仅以观察时间作为分母；若不完整，不用原始 `percentCPUUsage` 擅自填补。后一项的时间加权和单列诊断，保留原始数值。
* 长实验上可打印**同形状探索判据**：第 30 分钟 / 第 10 分钟总 working set <= 1.10、最后四点非严格递增、空闲累计 CPU < 5%（一逻辑 CPU）；这些要求与旧 M12-T111 方向相同，但计数指令、主壳、CLI、CPU采集及真实产品环境不同，绝不合并成正式 T111 通过。short 的 30/10 *秒* 比值只用于脚本和策略冒烟，不作为 30 分钟结论；其 `syntheticLongTrendChecks` 为 `null`。

## 已做静态校验及边界

* `node --check resource-probe.cjs`：通过。`python3 -m py_compile run.py analyze.py compare.py selftest.py`：通过。
* `python3 selftest.py`：6/6。只用虚构账本/静态 PNG 验证离线判据接受正常、拒绝哈希匹配的陈旧 PNG、拒绝缺 renderer 及 PID/creationTime 变化产生的 CPU 未知间隔。
* 这些证据不证明真实 Electron 探针已能运行，需协调者实测。无生产代码修改、无生产状态迁移、未启动任何图形程序。原先的源码审计/单测结果与本探针的未来实际结果应分别归档。
