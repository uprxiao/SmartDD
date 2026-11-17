# M14 复核修订的定向验证

日期：2026-11-16。依据：需求 R1.0、技术方案 T1.1、独立复核 C01–C16。本目录为研究实现／回放，**不接生产代码、不构建新 App、不计产品用例通过**。SmartDD／T3 修订与具名文件哈希见[source-baseline.json](source-baseline.json)。原始用户复核探针保留，不覆盖其结果。

## 1. 实际结果与层级

| 项 | 输入、实际执行与证据 |
| --- | --- |
| 真实事件 | import-recordings.py 从原复核 scratchpad 取九组真实模型录制，保留顺序／原生 ID／来源行与原件 SHA，剔除账号发现信息、用户扩展清单及 MCP 启动一次性票据；[原件／夹具清单](fixtures/recordings-manifest.json) |
| 时间线 | timeline.mjs 每实例转换；replay.test.mjs 回放 Claude、Codex、ACP 及实际切换／委派。显式诊断清单，未知关键类型作为覆盖失败；[结果](results/timeline-replay.json)。host 切换／交接信封来自实际规范历史重建，用于验证显示合同，未冒充生产录制 |
| 消息链接 | links.test.mjs 实际编译固定 T3 shared 识别函数；十二类样本＋真实 Agent 输出＋行列／symlink／无项目／修饰键／PDF 边界；[结果](results/links.json)。真实文件工作区点击、dirty 文档和系统编辑器尚待 App 验收 |
| 状态与目录 | runtime-contract 候选验证立即停止、默认模型、选项公布、最低版本／坏版、每轮权限、方案 B、父回合终结且输入冻结／排空后释放／再入队、单序号同步、四终态和受限；[结果](results/runtime-contract.json)。不把内存队列当生产调度器 |
| 审批／真实模型来源 | V08 原请求及文件结果只读核对，[证据](fixtures/approval-evidence.json)；Claude 原 maxTurns 失败保留在[v08-b 原结果](fixtures/v08-b-result.json)，当前转换器把它正确映射为失败终态 |
| 10 GiB SVN | shadow-git-benchmark.py：20,481 文件，实际分配 10 GiB，非稀疏；首次 70.1361s、不变增量 0.1835s、三文件增删改 0.1171s；[测量与清理](results/shadow-git-10gib.json)。高可压缩合成文本、仅 seed 已提交 SVN，其余未版本化；不是企业项目或高熵二进制性能认证 |
| Git 隐藏引用 | git-checkpoint.test.py 用真实 Git、脏工作树和已暂存内容验证 HEAD、用户 index 字节不变，增删改／重命名／二进制可见；[结果](results/git-checkpoint.json)；无回退动作 |
| 仓库外准备 | [106 个保留旧实验](results/portability.json)：入口、原资产 SHA、路径和所有 esbuild 包装；不是 106 次实验执行。[路径守卫](results/portability-guards.json)实际拒绝旧根、仓库内根及越界入口 |
| 实际移植复跑 | [执行回执](results/portable-execution.json)：Python 交接 18 项、同步／草稿 27 项、K01–K34 原合同，以及当前源码业务桥／两端构建和混合 build+transform 导入构建，从仓库外新目录运行；无模型调用。[K34 新结果](results/portable-canonical-result.json)依据日志中的确切 attempt 采集 |
| ABI | [Electron SQLite](results/electron-sqlite-abi.json)通过：Electron 42.11.14／ABI146，独立 better-sqlite3；Electron-as-Node 只测 ABI，不是浏览器页面或 App 验收；原 stderr 保留 |
| 文档与归档 | [文档审计](results/document-audit.json)：现行定义、用例账、快照原件、移走实验字节、生产输入未变、篇幅、链接；原文在[快照清单](snapshots.json)与[迁移前 Markdown](link-originals.json.gz)可恢复 |

## 2. 失败及修正

- V08 Claude 拒绝后反复调用直至 maxTurns 的原失败仍在夹具中，未修改原预期；研究转换器显式收口为失败，产品设计另提供“拒绝并停止”。
- 链接首轮以主项目直接依赖解析 esbuild 失败（项目无该直接导出）；改为显式传入依赖包路径后使用相同样本复验，不修改识别规则或预期。
- 复跑工具初次语法预检发现重复代码段／缩进，修正后先 py_compile，再进行原样输入的外部执行。
- 严格构建审计又发现四个仅 transform 的导入被误判为 build，以及一个 build+transform 混合导入未包装；保留[该轮原结果](results/portability-strict-attempt1.json)，修正解析与混合导入包装后对同一批输入复验。两个浏览器 main.mjs 的 runner 按原合同明确为 Electron，另用实际守卫防止回退 Node。
- K34 外部首轮发现 source-only 恢复根覆盖显式 owner 依赖，zod 查错位置；[原败与原因](results/portable-canonical-attempt1.json)保留。使用 setdefault 保留显式依赖根，第二新目录执行同一 K01–K34 全部通过，未改旧合同及期望。
- 链接修复首轮遇到范围外 M9 文档的长测试文件名，路径 stat 超长；收紧为受影响 M14 及入链文档、保留原文字节，并按已处理文件记账后续跑。只修改链接定位，不改旧实验结论或 §7 决定。

## 3. 复跑命令

Node 22+，Python 标准库；LINKS 需要 esbuild 的显式包路径及固定 T3 检出。以下均可从仓库外执行；变量 E 指向本目录，SCRATCH 指向复核原件的 scratchpad。命令不设置或打印凭据。

```bash
M14_T3_ROOT="$M14_T3_ROOT" node "$E/replay.test.mjs"
node "$E/runtime-contract.test.mjs"
node "$E/links.test.mjs" "$M14_T3_ROOT" "$ESBUILD_PACKAGE"
python3 "$E/git-checkpoint.test.py"
python3 "$E/portability.test.py" "$SCRATCH" "$M14_T3_ROOT"
python3 "$E/portability-guards.test.py" "$SCRATCH" "$M14_T3_ROOT"
python3 "$E/audit-docs.py"
```

原件重新提取需 `python3 "$E/import-recordings.py" "$SCRATCH/runs"`，会校验式剔除凭据形状内容，原录制只读。已入库的脱敏回放不依赖原机路径。

10 GiB 性能实验会真实分配数据，需要 fixture 大小另加至少 2 GiB 空闲，正常／异常都清理本轮临时根：

```bash
python3 "$E/shadow-git-benchmark.py" --gib 10 --output "$NEW_RESULT_JSON"
```

只更改文档或外部驱动不重打生产包；当前没有形成新包。测试用例、清理库存和逐实验说明分别由本目录 `编制验收文档.py`、`generate-cleanup.py`、上级 `编制复跑目录.py` 生成，后续修订先改生成脚本。

二次修订更正：原 T1.0“全部保留 T3 条目”和手写清单不足已修复。当前 replay 从固定 T3 Git 对象用 TypeScript AST 提取类型，负对照会抓出原遗漏的五项；复跑需要本项目锁定的 TypeScript 依赖及 M14_T3_ROOT。写入队列取消 pausedNoWrites 模拟门槛；真实模型证据在[二次实验](../20261116_二次复核修订验证/README.md)，原先内存测试不能证明 native 暂停。
