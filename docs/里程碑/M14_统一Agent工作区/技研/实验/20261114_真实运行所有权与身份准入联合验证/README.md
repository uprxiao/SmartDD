# 真实运行所有权与身份准入联合验证

日期：2026-11-14。D01，关联 Q13／Q46–50。承接 §4.103 的共享身份 claim／精确来源，将其接到当前源码生成的程序化注册器变体与真实 Codex app-server。最终 attempt-g1g8xZ 五项通过，未改产品代码。

## 基线和证据层级

SmartDD `5a9e04382441e24624cb94635f9d902c543a03d7`，383 项构建输入、两个 bundle 和三份源码变体的摘要已复核。旧实验整份 variant 落后于当前源码，会丢失历史根保护、adoptLibrary 复制提交和 binding_mode 等变化；本轮从当前文件生成最小补丁，保留现役逻辑。补丁／前后摘要与脚本归档，不把旧实验 bundle 当当前实现。

真实 Codex 0.167.1 固定二进制，仅执行 initialize／thread/start；没有 turn/start、模型或业务请求。HOME／CODEX_HOME 为隔离目录，Provider 为不可用的回环端点与虚构 key。真实子进程 PID／出生身份由现有 MacProcessIdentityReader 读取，先登记启动窗口再关联进程，接收到的原生 ID 直接交给候选宿主绑定入口。

Codex 测试夹具只将原 runFixture 的 runner／home 改为 Codex；适配资源与 prepared binding／源修订为合成。当前注册器的 opaque handle／owner、生命周期、资源租约和 schema 解析为实际源码，程序化来源读取、run 扩展和 claim 校验为研究变体。两个注册器在同一个宿主进程，不能算跨宿主接管。

## 五项检查

| 检查 | 结果 |
| --- | --- |
| O01 运行准入 | 程序化同任务入口启用后，实际旧 reserve 被写守卫拒绝；新 run generation 1，默认 binding_mode=current 保留；第二个同任务 run、另一注册器和复制 handle 均不能取得原运行权限 |
| O02 真实首次身份 | 真实 Codex thread/start 返回的 ID 与真实 owned run 同事务绑定；共享 claim／精确来源写入，run 当前 hash 前进，固定 source hash 和原应用计划字节不变 |
| O03 当前证据 | 同 ID 回调幂等，不同 ID／另一 owner 拒绝；受控移除 claim source、修改 run generation 时，活进程仍在但业务 context 拒绝。恢复夹具数据后原 context 可读 |
| O04 正常接续 | 活进程阻止后继 run；确认本次持有子进程退出后，run stopped／租约 released，但历史 claim 保留。另一注册器可准备 generation 2，以当次 revision 为新 source；旧回调拒绝，不能改后继运行 |
| O05 fork 前复核 | 后继 run 准备后，受控移除其来源，arm 被拒绝且 process record 仍 reserved；恢复来源后以未 fork 证明取消，未启动第二个进程 |

O03／O05 的删除和 generation 修改是故障注入，不是正常业务入口允许用户修改身份。O04 的后继运行只达到 prepared，不表示 Codex 原生历史可恢复；空线程可无持久历史，原生恢复探测仍按已有设计单独判断。

## 失败与清理

attempt-7JOvUX 前三项通过，O04 驱动预期旧回调报 CANCELED，实际 SCOPE_DENIED。源码确认 assertOwnedCapabilityRun 先调用 bridgePreparation，已停止运行在这里拒绝；仅修正精确错误预期，attempt-g1g8xZ 五项通过。失败及成功脚本／协议／数据库保留，没有扩大到任意错误均通过。

两次尝试中的真实 Codex 均 exit 0；再次通过内核读取确认原 PID／出生身份 stopped。保存数据库完整性／外键通过，活动 run 与未释放租约均为 0。最终一次两个 run stopped、五份租约 released；原生身份 claim 仍存在。只关闭本次捕获的 ChildProcess，没有按名称查杀。

## 设计影响和未验项

运行准入、准备、arm、活动业务 context 都需要核验精确 identity claim 的来源，不能只在第一次发布时查询一次。持久 binding／身份占用与当前宿主签发的 run handle 分开；克隆／序列化对象和另一注册器不继承权限。正常退出释放 run 资源，不释放历史身份；后继 run 有自己的 generation 和固定 source，旧回调被拒绝。

此批研究变体只覆盖默认 binding_mode=current；程序化 run-bound 来源、native-only 降级、新旧写入口完整迁移、GC、业务结果／私有桥、模型输入、异常宿主接管和动态后代仍未闭环。variant 显式拒绝未纳入的程序化 fixed-native 降级，不作为取消产品兼容要求的决定。实际跨 Provider／多 Agent 协作及恢复 UI 继续按原需求验证。

T3 `f313d0a6cb843551fb60e57a454a71e71a3a8c04` 的 ProviderSessionManager.releaseEntry 源码本轮只读复核；未运行其适配器或测试，不能由本实验替 T3 作运行结论。

复现：按固定依赖运行 patch.py、build.mjs、probe.mjs，须有归档声明的 Codex 二进制及 macOS 进程身份 helper；无需账号或模型端点。见[结果](result.json)、[来源与限制](source-review.json)、[原始归档](raw-evidence.tar.gz)、[归档摘要](archive-manifest.json)。
