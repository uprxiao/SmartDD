# F36 Ultra 软件层前置实验：关闭、并发导航和旧实例界面状态

执行日期：2026-11-25。仅隔离候选实验，没有更改正式业务源、Git、应用或用户数据。实际红测基线为前轮 BE01–BE08 的候选源 `/private/tmp/willyou-f36-lab-tljocnfp/candidate`，不是生产 HEAD；其生产起点和证据摘要见 `baseline-files.json`。该目录的原始三文件哈希与本轮候选哈希均已记录。`candidate-only.patch` 仅记录此 Ultra 实验相对于前轮候选的三文件差异，不可直接当最终实现。

## 结果与边界

| 场景 | 基线 | 本轮实验候选 | 说明 |
| --- | --- | --- | --- |
| 旧标签未完成关闭时，新同 URL 请求不能复用它；旧明确 ID 不再接受打开 | FAIL | PASS | 新 ID；最终保存列表中只有新标签 |
| 并发重复关闭只产生一条关闭历史 | FAIL | PASS | 同一原生 close 调用只一次，两次历史恢复只有一新标签 |
| 同 URL 两个挂起调用共享创建，取消一方不影响有效另一方 | PASS | PASS | 一次创建、一次导航 |
| 同 URL 所有旧等待者取消后新有效调用抵达 | FAIL | PASS | 新 ID，不加入已取消共享初始化；旧空白占位标签的回收另需定义 |
| B 前景时旧 A 的容器卸载 null 不得降层 B | FAIL | PASS | 原生视图模拟，实际 BrowserPageRegistry 放置算法 |
| 原生放置未完成时快速 A→B→A | FAIL | PASS | 最终挂载 A；不能证明过渡期从未显示过旧 B 或无闪动 |
| overlay 同 owner 再进入前，第一次捕获已取消但结果迟到 | FAIL | PASS | 不发布过期 JPEG，不再次停车 |
| A→B→A 后旧 A 的 null 不得解除新 A 的布局责任 | FAIL | PASS | 新接口参数设计见证，不是旧真实 RPC 通路复现 |
| 相同 owner 新 overlay 实例不能被旧实例的 release 解除 | FAIL | PASS | 新接口参数设计见证，不是旧真实 RPC 通路复现 |

同一测试输入 9 条：基线 1 通过/8 失败，隔离候选 9 通过。既有 4 文件回归共 57 通过。主进程 TS 检查需补齐私有冻结副本的共享原型引用（初次因漏复制 FileCodeTextarea 失败）；从同一前轮候选补齐后退出 0，未改生产或测试逻辑。保留初次失败。

测试使用真实 BrowserWorkspace、BrowserOperations、BrowserTabOpen、BrowserPageRegistry、内存 SQLite、合成固定 ID 和固定本地 URL。原生 children API、WebContents、导航与关闭门闩使用测试替身。不会访问 URL 或任何真实账号；Electron 仅 RUN_AS_NODE 启动 Vitest，没有启动窗口。不能代替打包软件的真实原生资源、用户端 UI、系统层或完整协议验收。两个实例参数仅主进程合同草图，尚未连接真实 renderer、IPC 生产者；还需明确调用者/宿主代际归属、每实例序列与失效边界。有效调用与正在关闭标签的所有竞态（特别是实际 UI/CLI 同时关闭、原生关闭请求是否自等待）、取消后空白标签回收及显式已取消 ID 恢复仍未验完。native 放置串行只证明最终顺序可收敛，设计仍须验证各异步边界的页面/host generation 和无瞬间错误前景。

## 原始输入与命令

`test-input.test.ts` 与私有源内 `src/main/core/browser/__tests__/ultra-lifecycle.test.ts` 完全相同。先在前轮候选的冻结副本上增加这一测试输入运行红测；然后仅应用 `candidate-only.patch` 运行同样测试绿测。Node 22.23.1 / Electron 42.11.14 / Vitest 4.1.11 / better-sqlite3 12.11.1。

在私有实验根 `/private/tmp/willyou-f36-ultra-layout-5IkHDj/source` 执行（缓存与夹具也隔离）：

```sh
LAB=/private/tmp/willyou-f36-ultra-layout-5IkHDj
WILLYOU_TEST_CACHE_DIR="$LAB/cache" WY_F36_ULTRA_FIXTURE_DIR="$LAB/fixtures" node scripts/run-tests.mjs src/main/core/browser/__tests__/ultra-lifecycle.test.ts --maxWorkers=1 --reporter=verbose
WILLYOU_TEST_CACHE_DIR="$LAB/cache" WY_F36_ULTRA_FIXTURE_DIR="$LAB/fixtures" node scripts/run-tests.mjs src/main/core/browser/__tests__/workspace.test.ts src/main/core/browser/__tests__/service-access.test.ts src/main/core/browser/__tests__/registry-shutdown.test.ts src/main/core/browser/__tests__/service-budget.test.ts --maxWorkers=1 --reporter=verbose
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json
```

原始退出码和原始输出：`red-initial.log` (1)、`green-initial.log` (0)、`existing-regression.log` (0)、`typecheck-node.log` (2)、`typecheck-node-recheck.log` (0，正常无输出)。
