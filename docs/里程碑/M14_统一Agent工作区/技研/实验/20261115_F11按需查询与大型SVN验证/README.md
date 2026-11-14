# F11 按需查询与大型 SVN 访问验证

2026-11-15。**F11 研究关闭，七项定向检查通过；未改产品代码，未执行产品验收。** [T0.1 §8.1.2](../../技术方案.md#812-查询覆盖与大型-svn-的按需成本f11)固定查询范围、依据、预算和完整／截断／未知；C1.6／P1.2 不变。

## 样本与计数口径

[样本](fixture.json)：真实本机 SVN 仓库／工作副本，12,352 文件、194 目录（不含 .svn），其中 12,288 个 512 字节普通文件、64 个 192 MiB 稀疏文件；12,891,193,344 逻辑字节、52,428,800 实际分配字节。只有代表源文件提交 SVN，其余未版本化。不是公司数据、全量已版本化项目、非稀疏 12 GiB，亦未测 svn status／update。

使用当前未改的 FileService／FileRootsService／FileSourceResolver／FileRecoveryStore／NativeFileBroker。研究 helper 在当前 native broker 上增加只用于隔离测量的 pread／readdir 计数，以及 query-list 的明确截断／跳过／前后目录 stamp；原 list／read／walk／search 算法未替换。query observer 复用授权根、protected identities 和 fd 锚定读取。查询证明归宿主范围，不代表原生 Agent 的全部读取都被接管。

[访问量原始结果](io-results.json)统计该 native 源码的逻辑 pread 和 readdir，包含重复 hash、`.`／`..`；不是物理块 I/O、页缓存缺失、全应用追踪或磁盘吞吐。实际 read 前后 hash 共约三遍读取，32 KiB 正文对应 96 KiB pread。串行实验原型每文件发一个 broker 请求；不宣称已经优化到成品性能。

| 检查 | 结果 |
| --- | --- |
| S01 启动／切换／交棒的目录子步骤 | 复用 F06 descriptor（只替换 fs import 作观测），21 次根／祖先元数据调用，无项目目录枚举／正文读取；当前文件服务开根与恢复初始化共 3 broker 请求，自己的空恢复目录另枚举两项 |
| S02 scoped query 对照旧 mask 搜索 | 同样 64 个内容文件，新查询枚举 1 目录、pread 98,304 字节；当前 FileSearchService 枚举 195 目录、pread 32,768 字节。mask 在 walk 之后生效。原／研究 helper 的同一实际 read 返回值一致 |
| S03 新匹配文件 | 完整负查询原返回空数组；新文件加入后重跑相同查询发现匹配并使旧依据失效。不能用旧返回项 hash 证明不存在 |
| S04 非命中文件变化 | 原本不匹配的已参与文件变成匹配，inode／大小保持；保存其 FileRevision 并重跑查询才能发现变化 |
| S05 预算、域与取消 | 受限枚举／正文标 partial，不支持不存在；192 MiB 文件不读正文；链接排除是显式域规则，不递归；列目录后取消在内容读取前结束，标 unknown；整次执行共享截止 signal |
| S06 查询期间新增成员 | 第一次枚举后插入文件，最终目录复核发现变化，标 unknown；新观察可正常完成，不无限重试 |
| S07 覆盖／身份 | 受管查询 complete 不认证 native-shell／第三方 MCP；整体保持 unknown、并行只读不开放。不同 binding 与已关闭 root 的旧依据拒绝 |

完整结果见 [result](result.json)。本批复用前轮六项文件／根替换与最终保存冲突证据，当前 bundle 718 输入与原 native 110 输入摘要一致；没有重复原生模型回合、实现 SVN 写者或新的全部 Agent 读取代理。

## 首败、合同和边界

首次夹具未建立原 FileRecoveryStore 要求的 userdata 根，搜索的恢复初始化报 MISSING；补既有目录初始化，并让新查询也等待原 recovery.ready，保持 protected identities 责任。随后第一次 S01 错把“无项目扫描”断言成“连恢复服务也不枚举”：实际自身恢复目录有 `.`／`..` 两项。修正为按原路径分类，仍保留并报告这项既有开销，没有删掉恢复步骤来制造零值。失败与保存的脚本保留在归档。

查询执行预算：128 目录、8192 累计项、每目录2048项、512候选（失败也计）、单文件256 KiB、正文4 MiB、200结果、1 MiB依据、执行截止15秒。完成既有初始化／根校验后进入执行截止；取消复用实际 broker。原有文件搜索 UI 不被这一新增入口替换，原生 shell／SDK／MCP 也不被伪装成受管只读。

固定案例 instrumented scoped query 约280 ms，旧搜索约110 ms：新查询职责包括版本依据，不能用目录数量减少推导更快。生成器、候选和文件服务本身可以审查；没有全项目 hash／copy 入口。没有检测所有 OS 进程的 I/O，也没有证明统一 UI／真实 Provider 的完整启动性能。观察不是跨文件原子快照，后续真实保存仍需原版本条件检查。

按研究关闭 §7.2，Q33 的完整声明／失败出口／当前权限及文件服务证据、Q34 的有界子步骤／明确访问集合和大多文件样本已具备；公司真实项目、全量已版本化非稀疏数据、p95／峰值内存和真实 App 仍按 A33／A34 未执行。产品验收 0／54。

[来源审计](source-audit.json)记录 SmartDD／T3 修订和9个具名源码入口，T3 搜索服务只作分层／truncated／refresh参考。[归档](evidence.tar.gz)与[摘要](archive-manifest.json)保存实际 bundle、原／研究 native helper、修改点、生成器、最终结果及计数文件；不打包 12 GiB 合成目录。复放需映射脚本所列临时依赖及本机 Node／macOS／SVN，不是产品安装包。
