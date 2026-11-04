# M12-P035 原生完整登录态复制组件 I

结论：**原始磁盘快照复制不满足完整 clone，明确丢失 Session Cookie。** 其余原生存储复制、来源保持和目标隔离已得实际绿测。本批不计 clone 命令、UI 或 T080/T081 整条通过。

## 冻结输入与环境

- 原1530文件：`/private/tmp/willyou-m12-p035-baseline-001/baseline.json`，SHA `25bd11826a43496695c61e36d4207de4edd4241cf9744cf2f17975d25576c4db`。执行后全部SHA仍匹配。
- 实际生产组件 `src/main/core/browser/profile-snapshot.ts`：`e3d9351363620792908e24492676e80e1f5bfb332af6fe35e71e214ab1074813`。另一实际编译生产源为 ApplicationError，共2份完整源快照；18个依赖源SHA、compiled host均保留。
- compiled host：`adf681957813d67a26f53f8ee74e112ae58defd1f3cb5f62ab6644eddb362c6c`；私有host源：`27da47bda73e72d87c87141179c2e7577a08ab8782d599a09d96925aa1fee487`。
- 真实Electron42.11.14、ABI146、macOS arm64。全程prohibited、零窗口、未挂载sandbox WebContentsView；没有桌面输入、Helper、CLI、PTY、外站或真实浏览器资料。
- 明确使用 `--use-mock-keychain` / app.commandLine同名开关，仅作为私有Cookie加密环境；不能称OS Keychain/safeStorage验收。
- 唯一私有HTTP源 `http://127.0.0.1:60869` 由同一Node控制器跨两个Electron进程保留，URL/源不变。Cookie/LS/IDB/CacheStorage/HTTP缓存均由真实原生Session及页面API创建，没有手写native文件或用DTO重建完整profile。

## 关键红测

活动A真实有：

- persistent Cookie：p035-persistent=cookie-A，httpOnly/lax，expiration=当前+3600。
- Session Cookie：p035-session=session-A，session=true。

flushStorageData和cookies.flushStore后，从A真实Session.storagePath取得源目录；目标路径用dirname(sourcePath)+去掉persist:的目标partition名推导。没有在复制前实例化B。

实际 `copyBrowserProfileSnapshot` 复制 **55文件 / 1,890,375 bytes** 后创建新B，其实际storagePath精确命中复制目录。B可读persistent Cookie，原属性一致；**B读不到p035-session**。原要求保留，未添加Cookie overlay、未改成只测persistent、未重跑掩盖这条红。

实际证据：host-live.raw.json 的 before.cookies、copy、targetStoragePathExact、afterCopy.bCookies；result.json 的 copied-native-cookie-p035-session。

## 实际绿测

- 活动A→B：persistent Cookie、localStorage、IndexedDB、CacheStorage、HTTP cache均保留原值；HTTP cache-only返回200及原字节，服务器cache端点仅有最初种子请求，没有回网补数据。
- 来源A的WC ID、原URL、未保存表单和原文档身份保持；复制前后所有被测存储值与Cookie未被复制组件改变，没有暂停/卸载A。
- 修改B的Cookie/localStorage/IDB/CacheStorage，并清B HTTPcache后，A仍是原值、原表单/URL/WC，HTTPcache仍可只读命中。
- beforeVerify回调每轮用真实Session.cookies.set+flushStore制造原生文件变化，共3轮；组件返回RESOURCE_BUSY，目标未公布、stage无残留。没有用直接写源native文件伪造这一事实。此处来源Cookie写入属于明确的变化夹具，在来源保持判据完成后独立执行。
- 第二Electron不实例化来源A，从已停止的真实A目录完整复制到C，**56文件 / 1,857,039 bytes**；C实际路径一致，persistent Cookie/localStorage/IDB/CacheStorage/HTTPcache均为原A，HTTP cache-only仍200。来源A整进程已结束，Session Cookie在整个App结束后的生命周期另行观察，不替代活动A→新B必须保留Session Cookie的原判据。
- 重开同一B/userData/partition/origin后：cookie-B/local-B/idb-B/cacheStorage-B均在；B缓存为空，cache-only失败且没有回网请求，符合清缓存后的持久状态。

## 清场观察限制

两阶段的业务结果均在进入cleanup前完整落盘。私有宿主finally中的Session flush/closeAllConnections序列没有完成末尾记录，raw停在cleanup；未对每个await单独落盘，所以不能确认究竟哪一个原生await停滞。

两阶段各由原90秒有界看门狗向**本次自有宿主**发SIGTERM结束。Electron最终exit0/signal=null不等于实际观察到app.quit回调；本批不声称正常quit/逐WC关闭回调已经验证。第二阶段结束前计划提前清场的检查实际发现App已经absent，因此没有再发送任何signal，记录在cleanup-stop-observation.json。

原15项判定13绿、1项Session Cookie方案红、1项显式native清场快照缺项。result.original-judge.json保留；adjudicate-final.mjs只分类观察限制和外部清场，不补造关闭回调。inactive来源数据和B重开读取有效，但“先前正常app.quit”没有证据。

后续私有驱动应为每个cleanup await单独记录步骤并给短上界，先关闭自有WC，避免再让无诊断的清场等待占满整段90秒；不为修清场重跑本批已绿存储矩阵。

## 精确资源释放

独立ps/lsof核验11个实际自有PID均absent：

`45035,45037,45049,45050,45053,45075,45555,45558,45559,45580,45581`

唯一实际数字端口 **60869** 已关闭，控制器HTTP连接/服务器已关闭。每阶段旧App精确进程全部消失后才启动下一阶段。资源已明确交回协调者，之后仅文件整理，无新增native/监听。

运行保留的private session目录包含合成数据，未连接日常资料，未将其当用户凭据；归档以manifest列出的原始API结果、服务器请求账、源代码/依赖哈希和判定为准，native缓存/依赖/运行目录不混入仓库证据。

## 下一步与复现

root负责在完整分区复制之外加入实际NativeStore全Cookie快照恢复和验证，覆盖session/CHIPS/原属性，成功后才能公布profile元数据；不能缩成只复制Cookie。clone命令/UI/manager intent、崩溃清理及OS权限尚未由本组件I验证。修复后定向复验原红，复制组件和未受影响原生存储分支按函数/输入SHA范围复用。

实际执行过的命令：

```
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p035-executor-001/cache node /private/tmp/willyou-m12-p035-executor-001/run.mjs --execute
```

同root/runtime-001已存在时驱动拒绝静默重放。需要新基线或复验时使用新的attempt/隔离根和新租约；不重放旧输入队列。本次没有改生产、公共账或Git。
