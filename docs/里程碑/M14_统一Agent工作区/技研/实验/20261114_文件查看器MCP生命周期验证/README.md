# 文件查看器 MCP 生命周期：独立技术验证

六项检查通过。使用当前 FileSourceResolver（真实 tasks 表／Drizzle）、FileRootsService、FileService、FileViewerService、本地 MCP Client／Server、原生文件 broker，以及当前运行注册器和一个真实自有普通 Node 子进程。所有文件均为隔离合成数据。

| 检查 | 实际证据 |
| --- | --- |
| M01 | 两个窗口 owner 各有自己的文件根／文档／MCP；读取内容一致，跨 owner 与错 generation 拒绝 |
| M02 | 普通 Agent 代用进程 exit 0、实际 run stopped 后，两个原查看器仍可读；直接修改夹具 tasks 的 runner／native_session_id 也不改变已有查看器对象。没有启动真实 Codex／Claude 切换 |
| M03 | Agent run 停止后，查看器通过实际 MCP 工具和 native broker 保存成功；外部写入后再次使用旧 ifMatch 得到 conflict，外部内容保留 |
| M04 | FileService.closeOwner 关闭 A 的 MCP transport，B 仍可读；已等待实际 Client.onclose 回调 |
| M05 | 改变任务 cwd 后旧根校验失败，旧 MCP 关闭，未悄悄读取新目录；重新 openScope／open 后取得新授权，新内容可读，旧请求仍拒绝 |
| M06 | closeDocument 撤销来源并关闭查看器；三份实际 transport 关闭回调收齐，没有用 close 方法返回代替关闭完成 |

设计结论：窗口／文件根／文档拥有查看器生命周期，run 不拥有它。Provider 切换不能调用 FileService.closeOwner 或重新配置全部 viewer adapters；保持 cwd 时保留文件区域，cwd 改变则让实际来源校验失效，并提示重新打开，不能把旧 lease 改指新根。查看器保存继续走原文件比较与保存事务，不授予 Agent 文件写权限。

范围：本地 first-party MCP resources 与条件写回；不是第三方 stdio 进程、MCP App 界面、真实窗口／IPC、SDK 切换或四类 MCP 同时运行。Electron stub 只禁止界面分配；文件服务、MCP 包、进程身份与 native broker 未替换。parcel watcher 使用原安装模块及原生依赖，记录摘要；本轮未订阅文件 watcher。

失败保留：最初 bundle 使 parcel watcher 的原生可选依赖无法定位，导入时失败、未建立夹具；改为加载实际外部模块。第一次实际探针遗漏 userdata 目录，M01 失败，捕获子进程已停止。补齐目录后 M01–02 通过，保存因当前执行环境禁止嵌套 sandbox-exec 而得到 unknown；诊断保留。获准在私有目录运行同一探针后六项通过，未删除产品 sandbox 或增加无沙箱重试。两次旧失败和最终结果各有 SQLite／运行收尾记录，不伪装成首跑全绿。

复跑：SmartDD cwd 下运行 build.mjs、probe.mjs；需原 native broker、macOS sandbox-exec 与 watcher 依赖。保存所需运行权限与本机沙箱有关。源码／native 输入摘要见 source-review，原始 broker 编译命令沿用既有 Git 目录实验。Q39 从静态核对推进为部分，不作整项产品通过。

[结果](result.json) · [运行审计](runtime-audit.json) · [源码](source-review.json) · [摘要](archive-manifest.json) · [原始记录](raw-evidence.tar.gz)。
