# F36 Ultra 补充技术试验：页面绘制语义与长寿命宿主动态回收

## 范围、输入和边界

同一冻结实验候选来源 `/private/tmp/willyou-f36-lab-tljocnfp/candidate`，锁版本 Electron 42.11.14、固定 agent-browser 及原生进程身份 helper 的 SHA 均记录于各轮 manifest。编译只读候选源码和依赖，不改共享候选/基线或生产工作区。每轮新建私有根/HOME/userData/sessionData/临时目录。仅固定回环 HTTP fixture 和固定 1.5 秒 payload 请求；阻断其他 HTTP(S)。从未显示或激活单一 BaseWindow，原生视图来自候选实际 BrowserPageRegistry。无模型、真实任务、外站、账号或用户数据。

真实 BrowserReferences.snapshot、页队列、固定 helper 点击及页级 CDP 截图；页面 JS 仅用于读取合成 fixture 结果。手动控制视图 visible 以观察策略，不是正式生产 paint hold 管理器。没有使用实际 BrowserService/Agent/UI RPC、真实系统前景点击或桌面截图。页面 document focus 与系统窗口焦点独立。

## 三轮结果（不覆盖原失败）

| 轮次 | 结果 | 解释 |
| --- | --- | --- |
| attempt-1-metadata-red | 34 个断言通过，1 个失败；5/5 PNG；退出 1、清场 0 window/0 WC、启动进程组空 | actualDestroyed、helper daemon stopped、client stopped、socketFilesRemoved 实际均满足，但附加的 socket 目录绝对为空断言失败：唯一残留为 .version。 |
| attempt-2-stale-placement-red | 58 个断言通过，1 个失败；7/7 PNG；退出 1、清场 0 window/0 WC、启动进程组空 | 区分活动端点和元数据，新增分类记录；切回 anchor 后，对已退到后台的 p 再 placement(null)，不正确地把 anchor 退到壳后。真实候选原生层序变为 p、anchor、shell，registry 两页 mounted 均 false。 |
| attempt-3-normal-churn | 343 个断言均通过；15/15 PNG；正常退出 0、清场 0 window/0 WC、启动进程组空 | 仅正常顺序切换分支，不发送第二轮已经证实错误的旧卸载。候选源码未修改，不能把此绿当作第二轮竞态已解决。本轮实际约 50.35 秒；25 个 payload 请求，20 次正常动态创建/导航/实际 helper 点击/重开/关闭及其他复杂流程、anchor。 |

第一轮的失败归因和第二轮的原生层级失败保留原始 raw.jsonl、result.json、launch.json、PNG、独立源文件及构建产物。各次其余流程不得计作正式 M16 验收。

## 1. 复杂页面绘制语义与新帧

fixture.html 固定 CSS animation、100ms JS timer、持续 requestAnimationFrame 的 Canvas 有四色由事件/异步内容推进的受控标记。由真实 helper 点击发起本地 HTTP 1.5 秒延迟；等待响应完成、目标步骤已由 rAF 写入 Canvas 且 frame 时间不早于 payload 完成时间。截图独立读取 PNG 实际像素，不以可绘制状态返回代替新帧。

第三轮代表性状态（原始读数见 result.json / verified-all-attempts.json）：

- 前台连续 CSS/rAF 及 payload 完成验证通过；A 在 B 之下可绘制约 452.5ms，rAF +55、timer +5、CSS animation currentTime +458.2ms，B 原生前景保持。
- 在 A 已派发真实请求、payload 尚 pending 时，显式将 A 的 native view 设不可绘制；约 421.3ms 区间 rAF +50、timer +4、CSS currentTime +416.7ms。此时 document.visibilityState visible→visible；仅记录了初始 visible/focus true 页内状态，并未观测 idle transition 引发 visibilitychange。系统窗口未 show 且未 focus。
- 本地异步响应在 A idle 期间完成，同文档、pending=0、step=3；恢复可绘制后观察新 rAF 时间及 Canvas step=3，截图呈该次预期 Magenta 色块。返回前景仍是同一文档、clicks=3。
- 三轮累计 27 张独立 PNG；每图实际几何、文件 SHA、25 个 Canvas 内点颜色类别均独立复核。使用四个固定目标颜色最近类别/距离分离判定并保存实际 RGB，考虑 macOS 色彩管理，不要求理想 sRGB 的数值完全相等。

**结论限定**：`View.setVisible(false)` 不等同网页页面可见性、CSS/rAF 暂停、计时停止或节省 CPU；本地 fixture 在固定版本和配置下仍持续推进。对于正式生产绘制 hold，还未覆盖多个持有者、一个释放而另一个 capture 仍在途、超时后的底层真实结算、真实服务入口。不能把手动顺序恢复试验当成该契约已实现。也不能把页内 focus true 当作系统前景聚焦通过。

## 2. 长寿命宿主动态循环及清扫

第三轮保持同一个 hidden 单窗口、相同 anchor 文档和 profile，4 批、每批 5 个动态页面；两个项目/任务交替，同一个固定 URL 的每次重开都产生新 pageId。每个页经过真实快照、点击和 payload 结算，anchor 在每次关页后重新展示，并确认内容及点击计数保留。每批结束 registry=1、WebContents=2（anchor + shell）；23/23 已记录真实 close 均核实实际销毁内容、helper 停止、client 停止、.pid/.sock/.stream 端点移除、queue closed/pending=0、旧逻辑 ID 不再存在。

| 采样点 | Electron 关联 working set KiB | registry / WC | 残留 .version 文件数 |
| --- | ---: | --- | ---: |
| anchor-only 基线（含前一复杂场景两个已关闭页面） | 519648 | 1 / 2 | 2 |
| batch 1 关闭后 | 537008 | 1 / 2 | 7 |
| batch 2 关闭后 | 553952 | 1 / 2 | 12 |
| batch 3 关闭后 | 541216 | 1 / 2 | 17 |
| batch 4 关闭后 | 556496 | 1 / 2 | 22 |
| anchor 关闭后、壳仍运行 | 446352 | 0 / 1 | 23 |

逐采样覆盖主进程与已知 WC PID；按 app.getAppMetrics 的 Electron 关联进程记录各 PID/类型/内存/CPU 原值。上述是短时探索，未给出长期不泄漏或 CPU 节省结论；并非全系统独占 RSS，不是正式 T111 或多小时动态场景。

**单独归因的残留**：每次真正关闭 helper 后，试验专属 socket 目录仍有 1 个 16 B 的 .version 文件，第三轮 23 个合计 368 B；独立 userData 的每页 helper home 也留下 23 个空目录（各含空 tmp）。不是活动端点或活进程泄漏，但在持续新建/重开中目录和版本元数据线性累积。source-compare.json 证明基线/候选 agent-browser.ts SHA 完全一致，不能归因新 F36 窗口迁移；旧实现已有相同 close 机制。需把终态元数据清扫纳入长期资源设计。

不能把清扫放进所有 `BrowserHelper.close()`。实际候选 agent-browser.ts 27–33 行 prepare 缓存一次初始化 Promise；51–76 行 daemon 已停止/连续三次 timeout 的恢复 close 后会同 helper 重连；102、133 行中断和失败也 close；service.ts 392、623 行取消延迟输入/新导航使用 close 后仍复用；page-registry.ts 174–183 才是页最终关闭。建议明确可复用的 helper 会话 close 与不可继续复用的页终态 dispose 之间的契约；只有 queue/实际 helper client/daemon/proxy 已可信结算以及确认页专属资源归属时清扫。未知/不完整结果保留可诊断的 deferred 清扫状态，不误删其他页或共享目录。目录数据超出本次观测的小型形状时须再明确清扫和重试规则。

独立 E 层 final-cleanup-contract.mjs 用新私有合成目录演示 10/10 文件系统终态契约：临时 close 保留、未结算 queue/proxy/client 或未知 daemon 不删、最终确认精确清扫、幂等、兄弟独立页不受影响、不识别内容保留、非目录对象不跟随。不是实际 helper 停止或生产代码实现结论。

实验结束后，离线一次性清扫本三轮**独立 fixture 自己在 /private/tmp 外部命名的 socket 目录**（2 + 4 + 23），均按 run userData + pageId 计算精确目录，确认每轮进程组空与原生窗/WC 均 0，且目录仅包含 .version。post-run-external-cleanup.json 保存清扫前文件名/尺寸/SHA，并核查全部精确目录已不存在。此是外部实验清场动作，不是产品 close 自然清场结果。没有删除其他 App、共享资源、正常仓库或日常目录。

## 3. 第二轮布局红测的含义

候选 page-registry.ts 149–161 的 `placement` 对任意来者若 mounted!==page 先 park 当前 mounted，并不区分请求 rect 是否 null；随后 rect null 又 park 该旧页。第二轮固定顺序实际反证：A(旧页)展示→B(anchor)展示→对 A 延迟卸载 null，最后 B 与 A 都在壳后、无 mounted。不是系统绘制黑屏，也不能把正常顺序第三轮当修复。应由单一布局裁决器保证旧/无效 null placement 不撤销当前前景，并结合 host/page/layout 代际及多 overlay 竞争去复验。生产修复待正式开发。

## 4. 复现和离线审计

每轮的 probe.ts / fixture.html / run.py / 产物 probe.cjs / manifest.json / 原始 JSONL 及截图已完整复制，不复制运行时隔离数据库/HOME/profile。原始私有 root（见 manifest）仅用一次；重新运行时应建立新的 /private/tmp/willyou-f36-ultra-* 独立根，再复制上述三个源文件，确保冻结候选来源和版本不变。构建命令（替换新 root）：

```sh
node -e "const src='/private/tmp/willyou-f36-lab-tljocnfp/candidate',root='/private/tmp/willyou-f36-ultra-NEW';const e=require(require.resolve('esbuild',{paths:[src+'/node_modules/.pnpm/node_modules']}));e.buildSync({entryPoints:[root+'/probe.ts'],bundle:true,platform:'node',format:'cjs',external:['electron'],alias:{'@shared':src+'/src/shared','@source':src+'/src','@main':src+'/src/main','@root':src},outfile:root+'/probe.cjs'});"
python3 /private/tmp/willyou-f36-ultra-NEW/run.py
```

`run.py` 仅启动确切隔离 Electron 子进程，独立 env、专有 root、新会话，记录 PID/组和退出状态；不得对日常实例执行。离线重验本档案原始证据（使用 Pillow）：

```sh
python3 verify-results.py attempt-1-metadata-red attempt-2-stale-placement-red attempt-3-normal-churn
node final-cleanup-contract.mjs
```

第二条仅重新执行 E 层临时合成目录契约，生成新隔离路径；不是真实 App 的验证。cleanup-test-residue.py 记录前次一次性清理方法，含确切原始 run 根且已经执行，不需要从归档再次运行。任何后续实际产品验收仍用完整正式候选和原 M12/M15 约束；343 断言数等只为本 probe 的技术检查，不能相加当成正式用例个数。
