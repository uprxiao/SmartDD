# Linux FileService下一最小接入契约（0执行）

依据：已接受r200-v5 Mac调用链（manifest `9e9d4fc0…59f1`）与Linux candidate-v2（`549cb344…345b`）。root已得readcore10/protocol12实测事实不代替本次静态缺项，也不等于FileService/App接入。

**先实现真实恢复bootstrap＋scan/private/protected读取，不先放public guard或source-save。** 当前硬阻塞：NativeFileBroker在[29行](/private/tmp/willyou-pptx-context-root-g328-9de5/r200-pptx-context-v5-package-source/src/main/core/files/native-broker.ts:29)拒绝非darwin；App在index.ts:141固定原native入口。即使未来单独接Linux命令，FileService.list/open/watch先等recovery.ready，后者先`initialize-recovery`再带`privateObjects:true`实际扫描，注册v1/parent两身份；随后普通read也携非空`protected`。当前Linux host两者均明确UNSUPPORTED，不能用空数组/空索引或伪physical-writable解决。

| 必经契约 | 当前真实形状／不可弱化的前置 | 准确出处 |
|---|---|---|
| root与目录 | inspect-root→canonical path+dev/ino；RootLease绑owner/scope/source/generation。目录身份来自`list.identity`，entry带name/path/kind/symlink/identity/size；Mac metadata只描述regular file，不应发明目录metadata API。 | roots.ts:40–60；files.ts:93–101；Mac broker:278–288 |
| initialize/scan | `{operation:initialize-recovery,path:userData}`→`{path:file-recovery/v1,identity,parentIdentity}`；当前uid/0700/no-follow＋parent fsync。真实list/read64KiB journal/stat draft/inspect source/list transaction；坏记录保留invalid＋quotaUncertain，不能假空。 | recovery-store.ts:59–83、99–135；Mac:412–429、670–680 |
| private/protected | 私有目录0700/文件0600、owner相同、禁symlink；普通read拒绝真实根/祖先/alias落入私有树，list仅过滤受保护child，受保护root不能假空。`expectedParentIdentity`必须比实际立即parent fd。 | Mac:143–213、215–280；recovery:182–188；FileService:615–616；Linux host:75–108 |
| checkpoint | issued ref＋draftUUID/version/baseHash/base64/encoding/bom→真实durable `{draftId,bufferVersion,hash}`；20MiB UTF8/41MiB OOXML。私有draft/journal fsync、同版本幂等、旧版本拒绝、refreshRecord复核。**源已撤销时仍可私有checkpoint**；强readOnly禁写，不得误要求当前source live。 | FileService:440–463；Mac:485–552 |
| resolve/recovery材料 | resolve只认fingerprint/version/hash及原inode，旧回执返回false；标记resolved而非抹除恢复史。inspection路径只能由已核journal导出，stat/chunk需parent身份；current/displaced/draft/materialized独立保留。 | FileService:478–493；recovery:173–238；Mac:554–567 |
| save/copy | 当前lease与物理writable＋完整revision/baseHash CAS；quota、draft/candidate/displaced/materialized、transaction identity event、fsync/receipt；unknown/conflict不重试/不反向覆盖。copy来自main chooser且不能覆盖source。Mac save/copy另有kernel sandbox写范围；openat2检查本身不能替代写入时限制。 | FileService:509–560；actions.ts:95–112；write-confinement.ts:4–21；Mac:569–668 |

当前Linux stdin上限1MiB只适合read-core请求，不能承接合法20/41/256MiB base64写入；Mac总输入上限360MiB仍另有操作预算（Mac:738–745）。下一bootstrap/scan阶段无须改大输入上限；writer阶段再按原合同有界设计。

最小真实复验：用真正Linux子进程承接原FileRecoveryStore.ready，保留透明IPC边界，①真实新建并重开私有根/实际空目录，②现有公开有效＋损坏journal/draft fixture实际扫描（非checkpoint生产者通过），③private owner/mode/symlink/祖先alias及parent身份保护、用户同名前缀不误隐藏。可复用原native-broker.test.ts:318–342、471–490、500–546及write-confinement.test.ts相应断言，不能把Mac旧绿转成Linux绿。

本次仅建议/静态调用链；未实现、未测试、未启动Docker/App/编译、未改guard/公共账，0整条。精确字段、每叶SHA和逐行来源见JSON。

已通过子层仍有原契约差异：Mac broker.mm:306对chunk>1MiB给TOO_LARGE，candidate2 host:135给INVALID_INPUT；host:124对stat资源>256MiB也给INVALID_INPUT，FileService.open:346只捕获TOO_LARGE后才走原metadata fallback。当前10项据candidate2留现状不变；接线前须按原schema/预算/error/cancel完整契约对齐，不能拿新测试期望覆盖原业务。

LinuxKit只读25项不能证明写入环境适用。原G266/G267写约束负控仍待真实组合策略验证；不清除、不推“不适用”、不建议取消guard。
