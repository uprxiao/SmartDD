# F36 BE04／BE05 旧版软件层复现与契约验证

## 1. 基线和证据边界

- 源码 a0acddb3a2325c6bf732adaa7e954ce4d767a2c3，复用协调者的冻结源码归档。实际读取和执行的 26 个生产／已有测试／配置／静态输入均与该提交 Git blob 字节完全一致，散列见 production-inputs.sha256。此文件以冻结源根为校验目录，不以证据目录为校验目录。
- 独立私有测试根 /private/tmp/willyou-f36-reopen-e_n5l76z/source，单 worker，私有 Vitest cache。依赖只读链接已安装的锁版本；无主仓库／协调者 candidate／Git 修改，未运行 Electron UI、真实网站、业务数据或账号。
- Renderer 使用实际 AgentWorkspacePanels、AgentBrowserSurface、BrowserWorkspaceStore、NavigationStore、Panels、open-presentation 和 shared createEventEmitter。不替换浏览器／面板状态实现。仅 IPC 的确定性合成响应／事件、与本测试无关的文件／终端／差异／附件 UI 和 agentTasksStore 数据为夹具。意图记忆直接调用实际 composer 使用的函数，不声称完整 composer/Agent 工作链已经验证。
- Main 软件测试使用实际 BrowserService、BrowserWorkspace、BrowserTabOpen、BrowserOperations、内存 SQLite 及实际 migration；只将原生页加载完成边界扣住或返回合成结果。未实际创建原生网页、未真实导航。结果属于开发前 U/I 软件层，不可计入真实 App A/S 验收。

## 2. BE05：可重复失败时序

| 场景 | 前置和真实软件事件 | 旧基线结果 |
| --- | --- | --- |
| 红 A | 点击最后一页关闭；宿主空状态的 changed 刷新与 close RPC 返回后的刷新均捕获空 snapshot、回复暂扣；记住后续新用户输入的展示意图；释放旧空回复；宿主再按 changed→open-presentation 发布新页 | 新意图在记住时 guard=true。React effect 自动收尾面板令 revision+1，没有新的真实用户动作。新展示事件到达时 guard=false，select=0，panel=files，地址空；产品期望 active=browser 失败 |
| 红 B | 相同前置；利用 React Profiler 在真实空 store 已 commit、其 passive cleanup 尚未执行的窗口注入 changed→show；新 snapshot 与 select 回复均暂扣；待真实自动收尾再释放两回复 | 首 guard=true，select=1；auto cleanup 随后 revision+1；两回复完成后 host 和 renderer store 都选择同一个新页，但第二 guard=false，浏览器面板仍未打开、地址空；同一用户行为断言失败 |
| 补充红 C | **先**记住旧展示意图；用户随后真实关闭最后一页，但旧空回复仍扣住；旧意图迟到的新页 changed→show，再释放旧空回复 | 旧基线在实际关闭动作点未立即撤销展示：revision 不变、guard=true、select=1，迟到地址出现。应当 no select（明确用户关闭优先）的断言失败 |

红 A 与红 B 的终态失败不是驱动定位失败，分别由最终真实面板状态断言失败得到。最终脚本 f36-reopen-probe.test.tsx 同样判据独立执行两轮（run2/run3），每轮 2 红 + 6 绿。红 B 的注入只落在真实 React commit 到 passive effect 间的固定窗口，是明确的竞态可发生性证据，**并不能证明用户现场真实发生过这一特定微观顺序**。红 C 用独立补充脚本仅筛选该用例，1 红 + 8 未执行；未改动前述锁定八用例脚本。

六条正向控制都通过：正常关闭完全收尾后新展示同页加载→ready；新的非空 snapshot 先入 store 可压掉旧请求；明确的用户最后关闭仍应取消先前意图；用户在首 guard 前、select 回复前切换至文件面板不被覆盖；background 不抢面板而有效页可由真实 reveal 函数查看，闭页 ID 在模拟的 host select 拒绝后不再打开。

真实源码因果链（相对冻结源根）：

1. src/renderer/features/agent-tasks/agent-task-view.tsx:1530 发送输入时调用 rememberBrowserPresentation；open-presentation.ts:31、49 按 revision、task 和当前工作区进行展示有效性判断。
2. src/renderer/features/browser/store.ts:36 的 close 直接执行 RPC，实际关闭动作点没有同步撤销旧展示意图。
3. src/renderer/features/browser/workspace.tsx:67–80 把旧空 snapshot 的自动收尾交给 workspaceHeader.onClose；src/renderer/features/agent-tasks/workspace-panels.tsx:94 将该回调绑定到 Panels.close。
4. workspace-panels-store.ts:22–26 的 close 无条件 invalidateBrowserPresentation，混淆了真实用户关闭和程序派生的空面板收尾。
5. store.ts:60–65 两次 authorize 检查逻辑有效，但接收到的 revision 因来源混淆而错误变化；A 在首次 guard 阻断，B 在 select 回复后第二次 guard 阻断；C 反方向则是旧意图在明确关闭后、空收尾前未失效。

因此新宿主本身并不会自动解决 UI 竞态。建议最低改造单元：明确用户操作与派生 UI 整理的不同语义。显式标签关闭（标题栏点击、原生快捷键都经过 store.close）在异步关闭 RPC 前同步撤销此前展示；显式 panel close／切换／task 切换继续保持现有 revoke。自动空 surface 清理使用独立回调，只整理 panel，不把 revision 当用户动作递增。保留原 show 的前、后两次 guard 及 store 的 latest-request-wins。候选须使用完全相同的红测与用户优先控制复跑，不能通过放宽 guard、取消真实关闭权限、改变测试预期或忽略 C 宣称通过；再检查派生清理与实际新展示状态的新颖性。此为软件根因和建议，不是正式生产修复。

## 3. BE04：实际宿主软件契约

f36-open-contract-probe.test.ts 在实际服务及 SQLite 上 4/4 通过：

- host 对缺目标、同时传 URL+pageId、既有 pageId+new、既有 pageId+profileId 四类无效参数均拒绝；两类合法单目标经 parser 接受。
- 逻辑最后一页关闭后 SQLite closed 保存旧 ID，当前 tabs 不存在旧 ID，旧 ID 的 select/open 均拒绝，不分配模拟原生页；新的明确 URL 返回不同 ID 和 loading；取消 duplicate show 和新导航副作用，同 requestId 重读原回执，异参冲突，关闭后重读 receipt 不重新创建 page。
- 延迟加载闭页后收到旧完成：receipt cancelled，重放不复活页面；不同 requestId的新 URL 得另一 ID、正常新 receipt。
- 直接 reserve matching 只作逻辑算法检查：相同完整 URL/同 profile/同任务能复用 pending；不同 query/hash、profile、task、force-new 均不同 ID。未验证真实 profile 绑定（留给正常集成验证）。已有旧 workspace.test.ts 14/14，service-access.test.ts 的三个开页/取消专项 3/3（31 其他用例没有运行）。

实际生成 schema 差距：src/shared/browser-commands.generated.json 的 browser.tab.open input required=[]，不含组合约束；实际 browserDefinition 投射原 input 并增本地描述。现用 AJV validator 对以上四类无效参数也判 valid=true，而真实宿主 parser 全部拒绝。私有 schema 对象的组合约束实验使 AJV 对四无效类拒绝、两合法类接受，说明当前宿主通常使用的本地 validator 支持该表达；未更新生成源、包、CLI/MCP provider schema，也不承诺已冻结旧会话变更。下一步正式设计应在 schema 生成源/说明文本明确互斥约束，继续保留严格 host 校验，并检查真实 provider 投射／冻结会话兼容。旧错误“本任务没有指定的网页标签”目前明确拒绝旧 ID但可执行恢复指引偏弱，仍需补不误导的用户提示。

## 4. 运行记录和失败边界

- renderer-run1：红 A 成功复现；B 初版在异步 act 尚未注入前 React 已收尾，首 guard 的夹具前置不满足（不可计入红 B）；背景 reveal 的关闭按钮定位失败是 pending host 标题不同。分别改为真实 React commit 注入、等待 ready 后按真实标题定位。renderer-run2 / run3 锁定同一脚本独立重复：2 红 + 6 绿。早期脚本 renderer-driver-attempt01.test.tsx 与日志保留。
- host-run1：0 tests，初始 archive 缺实际必须的命令映射静态文件；从同一已冻结 Git commit 精确补齐，见 static-inputs.json，不改策略/产品代码。host-run2 4/4。
- schema-attempt01：初版错误要求 definition input 与 source 完全相同；实际 definition 只增描述，纠正诊断的无关断言并保留记录，最终诊断完整输出。
- 已有 broad renderer 两次尝试均 27 pass / 1 fail，失败为与本轮 BE04/05 无关的长 diff 线号用例。首轮本机 main 依赖缺 @pierre/diffs；次轮只读补 link 精确 1.7.0-beta.4（dep-closure.json）后发现该外部包跨安装目录的 React 实例冲突（useContext null），未修共享依赖／其他业务；明确保留缺项，专项执行 open-presentation/workspace 23/23，workspace-panels A73/A65/G2 4/4（另 1 长 diff 未执行）。不得把这条解释为 F36 生产回归已通过。

## 5. 可复跑（在独立源副本根）

将证据脚本按如下路径**复制**进实验源根（禁止用其替换现有测试或生产模块）：

| 证据脚本 | 源根相对路径 |
| --- | --- |
| f36-reopen-probe.test.tsx | src/renderer/features/browser/f36-reopen-probe.test.tsx |
| f36-prior-close-probe.test.tsx | src/renderer/features/browser/f36-prior-close-probe.test.tsx |
| f36-open-contract-probe.test.ts | src/main/core/browser/__tests__/f36-open-contract-probe.test.ts |
| f36-schema-diagnostic.mjs | scripts/browser/f36-schema-diagnostic.mjs |

依赖与精确版本见 runtime-versions.json，现有私有配置使用 WILLYOU_TEST_CACHE_DIR。将以下变量替换为新建的私有绝对目录（host fixture 要以 /private/tmp/willyou-f36-reopen- 为根）：

```sh
env WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-f36-reopen-EXAMPLE/cache WILLYOU_F36_TRACE_PATH=/private/tmp/willyou-f36-reopen-EXAMPLE/renderer.jsonl node node_modules/vitest/vitest.mjs run src/renderer/features/browser/f36-reopen-probe.test.tsx --maxWorkers=1 --reporter=verbose
env WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-f36-reopen-EXAMPLE/cache WILLYOU_F36_TRACE_PATH=/private/tmp/willyou-f36-reopen-EXAMPLE/prior-close.jsonl node node_modules/vitest/vitest.mjs run src/renderer/features/browser/f36-prior-close-probe.test.tsx -t 'supplemental RED C' --maxWorkers=1 --reporter=verbose
env WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-f36-reopen-EXAMPLE/cache WILLYOU_F36_CONTRACT_DIR=/private/tmp/willyou-f36-reopen-EXAMPLE/fixtures WILLYOU_F36_HOST_TRACE_PATH=/private/tmp/willyou-f36-reopen-EXAMPLE/host.jsonl node scripts/run-tests.mjs src/main/core/browser/__tests__/f36-open-contract-probe.test.ts --maxWorkers=1 --reporter=verbose
node scripts/browser/f36-schema-diagnostic.mjs
```

scripts/run-tests.mjs 按项目约定 Electron-run-as-node，仅运行软件层 SQLite 测试，不创建 Electron GUI。先 mkdir 指定私有 fixture 目录。旧基线期望保留 2+1 个红测；候选修复后应将相同断言全部转绿，不应修改这些红测判据。用例数仅为局部软件验证，不代替用户可见问题的完成统计。

离线复核证据：从本证据目录运行 python3 verify.py，应得到 verification-summary.json 中的结构化结果；再核对 MANIFEST.sha256。真实 App 后续必须用独立本地数据、原生网页生命周期和实际模型输入/展示链路重放，分别收集 host 受理及 ID、renderer revision、explicit/auto 关闭来源、first/second guard、select、panel.open、refresh 与实际地址；原始脱敏现场尚未取得。运行结果不证明真实系统层、原生关闭收尾、真实 Agent 行为或冻结会话兼容。
