RSS原始数据补充（不改原S02红、不替换采样点）

15→30分钟合计 +4,030,464B（3.84375MiB）；20个原PID/出生时间/路径逐点一致。原before四点仍严格递增，保留失败。

| 原PID/进程 | 15→30净增 | 占净增 |
| --- | ---: | ---: |
| 72492 WillYou | 2.62500MiB | 68.29% |
| 72621 WillYou Helper (Renderer) | 0.82812MiB | 21.54% |
| 其余18进程净额（含减少者） | 0.39062MiB | 10.16% |

主进程72492四个原before值：317341696→317964288→318390272→320094208B。对应15/20/25/30分钟每批5个CLI后即时增加146325504/150749184/154599424/157122560B；到下一原before点又分别回落145702912/150323200/152895488B。最后15分钟主进程共有47次RSS下降；1515.058→1520.054秒下降154812416B。合计曲线有48次下降，不能把四个milestone的严格上涨扩写成全曲线从不回落。

renderer72621净增868352B，最后15分钟记录到一次98304B回落。其余完整PID、birth、可执行路径、每批before/after及下一before差额均见rss-attribution.json。这里只观测RSS回落，未采集GC事件、V8 heapUsed/external或保留对象，不能确认GC，也不能证明泄漏、plateau或具体缓存归因。

有界静态核查仅列事实：operations.ts的SQLite记录为7天保留/单摘要64KiB；references.ts每次快照替换refs映射；CDP捕获由finally finish移除；renderer store每task替换当前state、模块taskMap未见淘汰；终端scrollback10000行。具体源码/准确行与整文件SHA见rss-static-source-evidence.json。这些均不足以把本次2.625MiB主进程增长或0.828125MiB renderer增长归因到某结构。

下一最小验证建议（未实现/未执行，须另租约）：只对增长最大的主进程做一批同样5CLI和约1分钟静置，对齐少量RSS/heapUsed/external与被动GC事件，禁止强制GC、删除审计或更换原长期取点；若仍增长再针对保留对象调查。该短诊断不代替原30分钟S02、不为本轮换预期。
