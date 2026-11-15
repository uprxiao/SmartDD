# 0.1.5 发布记录

状态：**[v0.1.5个人预发布](https://github.com/uprxiao/SmartDD/releases/tag/v0.1.5)已公开，实际下载、隔离安装及启动核验全部完成。** 发布代码由`feature/0.1.5`进入main，附注tag对应`463935bddd00cdb0e09ac8391bb29241cd2fa830`；本稿后续归档只改文档与证据，不移动发布tag。

## 原因与范围

用户已授权完整提交、合并、tag、Actions、下载与隔离安装验证流程，并授权夜间自主执行。0.1.4 附注 tag 已占用但发布门禁失败，按项目规则保留原 tag 与失败；本次使用下一版本 0.1.5，继续 preview、非 latest、无 Developer ID 签名及公证，Windows／Linux 业务仍为实验性。

M13 的完整交付与排除边界沿用[阶段交付](../里程碑/M13_应用Skill与MCP插件化重构/交付说明.md)。[0.1.4 记录](release-0.1.4.md)保留原 32 项过时测试合同修复、完整候选 CI 成功和后续 tag 门禁失败的全部事实。

## 时序缺陷与验证

真实浏览器组件在下载面板 DOM 提交后，文档级 Escape 监听由 useEffect 延后注册。菜单项卸载使焦点落到 body，首个 Escape 不经过组件内冒泡处理，此时可能丢失。

新增确定性用例：父 Profiler 的提交回调在 DOM 已存在、passive effects 尚未执行时发唯一首个 Escape。原实现 defaultPrevented=false，红测真实失败。将该监听改为 useLayoutEffect，在提交内就绪；不移动焦点、不改 IPC 或业务授权。[红测](release-0.1.5-evidence/escape-commit-red.txt)、[绿测](release-0.1.5-evidence/escape-and-t11-green.txt)。

- 受影响浏览器工作区全部 17 项通过，保留菜单焦点、关闭回执、第二个 Escape 不消费等原断言。
- Esc 与 T11 授权拒绝定向 3 项通过，其余 94 项因过滤未执行，不代替完整 CI。
- T11 为真实持久化／运行组合，在 tag CI 更重负载下触及 5s；仅该用例设 20s 运行预算，不改自身审批、伪造哈希、无授权零发送断言，不全局放宽。
- 类型检查通过。生产差异为Escape监听提交时序及应用版本，已用新包补实际App流程。原生CLI/PATH生产代码未改，适用的0.1.4真实回归按[源码适用性核对](release-0.1.5-evidence/public-delivery/dock-path-source-reuse.json)复用。

## 候选包实际复验与 CI 收口

本机新包由 `461fefb536148edbe40e43e585e5f6f3a2b3e1b3` 冻结构建；[原生六项检查](release-0.1.5-evidence/local-candidate/native-smoke.txt)、严格 codesign 检查、[空主页正常退出](release-0.1.5-evidence/local-candidate/empty-startup.json)通过。

[实际浏览器回归](release-0.1.5-evidence/local-candidate/browser-attempt003-verdict.json)通过：真实菜单打开下载面板，菜单项卸载后焦点自然在 body；单次后台 CDP Escape 关闭面板，不移动焦点、不改变下载记录，无 renderer 异常。原进程10032正常 code0/signalnull，准确观察的 PID/TCP 均空；只读库核无 CLI/能力运行、密钥或 AI 快照。这里只复验受影响流程，不冒充在新包重跑全部 M13。

保留[首轮测试守卫失败](release-0.1.5-evidence/local-candidate/browser-attempt001-failed.json)：守卫错误假定仅一个窗口，未进入验收输入；此次未取得正常退出，不计通过。003原始回执证明浏览器确有合法透明后台窗口，守卫改为 PID出生身份、主窗口ID/WebContents/URL与精确后台窗口角色分类。002前置只读打开 SQLite 失败，未启动 App；003仅在无 WAL/SHM、无持有者且完整文件身份与哈希不变条件下使用 immutable 只读核对，未写库恢复。下载记录本身不跨 App 持久化，因此新进程单独准备一次23字节本地附件；旧文件保留，合成任务不增建，没有模型或账号调用。

[候选完整 CI 43735252560](https://github.com/uprxiao/SmartDD/actions/runs/43735252560)有6688项通过、1009项跳过，唯一恢复测试超过5秒（[原日志](release-0.1.5-evidence/candidate-first-ci-failed.txt)）；原浏览器17项全部通过。恢复用例对整份 SQLite Buffer 使用通用深相等，反复逐元素遍历；改为 Buffer.equals 保留逐字节完全一致判据，不增加超时、不改产品逻辑。原文件13项本机通过，耗时13.48秒；修改后13项通过，耗时9.56秒，原 CI 失败场景797毫秒（[结果](release-0.1.5-evidence/read-context-byte-equality-green.txt)）。

[冻结输入核对](release-0.1.5-evidence/local-candidate/test-only-package-reuse.json)证明该次只改一个测试文件，生产源码、依赖、原生组件、配置与候选包哈希未变，复用已验收本机包。UI复验后的[候选包严格签名](release-0.1.5-evidence/public-delivery/candidate-post-run-signature.json)也通过；最终公开CI包另作了独立下载与安装核验。

## 最终发布与安装结果

| 项目 | 实际结果与证据 |
| --- | --- |
| 发布代码／标签 | `463935bddd00cdb0e09ac8391bb29241cd2fa830`；附注对象`95d70b94e538f0541e09328d1dccd06ddb5c702c`。[main／tag远端核验](release-0.1.5-evidence/public-delivery/promotion.json)通过，v0.1.4原失败标签保留。 |
| 候选完整CI | [43738425686](https://github.com/uprxiao/SmartDD/actions/runs/43738425686)全部成功：类型、发布规则、准备、6689项通过／1009项按原配置跳过、编译。 |
| 标签发布CI | [43741922703](https://github.com/uprxiao/SmartDD/actions/runs/43741922703)九个任务全部成功；同提交再次完整检查、四目标安装包构建及发布。[原始任务回执](release-0.1.5-evidence/public-delivery/actions.json)、[检查及原生摘要](release-0.1.5-evidence/public-delivery/ci-native-summary.txt)。 |
| 公开资产 | 七种安装包、四份CI清单、SHA256SUMS共十二项齐备。七包的GitHub上传字节摘要／大小均与同一提交的CI清单、校验和逐项一致。[资产核对](release-0.1.5-evidence/public-delivery/asset-integrity.json)。 |
| 各目标原生检查 | Mac arm64／x64均为SQLite、PTY、语音、文件Broker、Office、Watcher六项通过。Windows／Linux的SQLite、PTY、Watcher通过，其余三项为不适用；不替代完整平台业务验收。 |
| 公开ARM实下载 | 617,779,124字节；SHA256 `3611ed7fa2998c749b46e2ce6fbeb50cede26acb26c6d00b55340582234e2c74`，与CI、GitHub摘要一致。[实际下载回执](release-0.1.5-evidence/public-delivery/actual-arm64-download.json)。 |
| 隔离安装 | 只读挂载→ditto至独立目录；20,295项路径、模式、文件字节及符号链接库存完全一致；严格codesign及实际安装副本六项原生检查通过；自有镜像已卸载。[安装回执](release-0.1.5-evidence/public-delivery/install.json)。 |
| 公开包启动 | 全新私有userData／CLI HOME，实际空主页与导航显示正常，rendererErrors为空；原进程51718正常退出code0／signalnull，准确PID／TCP均空；只读库核项目、任务、运行、密钥及AI快照均为零。[独立复核](release-0.1.5-evidence/public-delivery/coordinator-verdict.json)、[截图](release-0.1.5-evidence/public-delivery/home.png)。 |

公开CI包安装副本ASAR SHA256为`029878307a37ec7e2508fb49b19a4e1504d90eb5525cbad7b01fc9ace1584336`；可执行文件与Helper的独立哈希见[实际绑定](release-0.1.5-evidence/public-delivery/binding.json)。该绑定区别于本机候选包及原App062；没有把旧二进制身份冒作公开包。

本机实际下载与安装集中于Mac arm64；其他目标的完整性依据服务端摘要与各自平台CI，不声称均在本机重新下载或安装。下载阶段原顺序／三路传输回执保留，按准确PID及内核出生身份停止；已有分段用于续传，其前缀哈希与最终文件或保留分段一致，随后集中带宽完成ARM下载。代理与按请求直连的1MiB有界探针没有得到更快路径，保持既有网络设置。协调停止不计作产品失败，也不改变M13唯一用例账。

精确驱动源码、冻结清单、审批输入及回执在[归档清单](release-0.1.5-evidence/public-delivery/manifest.json)；完整CI／原生原日志、完整安装库存及原始传输材料保留本地，路径、大小、SHA见[原件索引](release-0.1.5-evidence/public-delivery/local-raw-index.json)。资产核对的源哈希对应[原Release快照](release-0.1.5-evidence/public-delivery/release-original-snapshot.json)；交付前复读快照仅下载计数变化，资产身份、大小和摘要保持一致，见[快照关联](release-0.1.5-evidence/public-delivery/release-snapshots.json)。App、安装包、数据库、凭据和原生二进制依忽略规则留在本地，不提交Git。

继续采用preview预发布，非latest，无Apple Developer ID签名及公证。macOS arm64为本期业务验收环境；Intel真机及旧阶段暂缓项沿原边界，Windows／Linux完整业务仍为实验性。Claude纯订阅取消范围沿M13需求及唯一用例账，本轮未把它改写成实测。实际安装在独立目录完成，日常`/Applications/WillYou.app`保持用户自行安装试用的安排。

下载：[Mac M系列DMG](https://github.com/uprxiao/SmartDD/releases/download/v0.1.5/WillYou-0.1.5-mac-arm64.dmg)。其他架构与格式见[Release](https://github.com/uprxiao/SmartDD/releases/tag/v0.1.5)。
