# 0.1.5 发布记录

状态：执行中，尚未合入 main、打新 tag 或公开 Release。

## 原因与范围

用户已授权完整提交、合并、tag、Actions、下载与隔离安装验证流程，并授权夜间自主执行。0.1.4 附注 tag 已占用但发布门禁失败，按项目规则保留原 tag 与失败；本次使用下一版本 0.1.5，继续 preview、非 latest、无 Developer ID 签名及公证，Windows／Linux 业务仍为实验性。

M13 的完整交付与排除边界沿用[阶段交付](../里程碑/M13_应用Skill与MCP插件化重构/交付说明.md)。[0.1.4 记录](release-0.1.4.md)保留原 32 项过时测试合同修复、完整候选 CI 成功和后续 tag 门禁失败的全部事实。

## 时序缺陷与验证

真实浏览器组件在下载面板 DOM 提交后，文档级 Escape 监听由 useEffect 延后注册。菜单项卸载使焦点落到 body，首个 Escape 不经过组件内冒泡处理，此时可能丢失。

新增确定性用例：父 Profiler 的提交回调在 DOM 已存在、passive effects 尚未执行时发唯一首个 Escape。原实现 defaultPrevented=false，红测真实失败。将该监听改为 useLayoutEffect，在提交内就绪；不移动焦点、不改 IPC 或业务授权。[红测](release-0.1.5-evidence/escape-commit-red.txt)、[绿测](release-0.1.5-evidence/escape-and-t11-green.txt)。

- 受影响浏览器工作区全部 17 项通过，保留菜单焦点、关闭回执、第二个 Escape 不消费等原断言。
- Esc 与 T11 授权拒绝定向 3 项通过，其余 94 项因过滤未执行，不代替完整 CI。
- T11 为真实持久化／运行组合，在 tag CI 更重负载下触及 5s；仅该用例设 20s 运行预算，不改自身审批、伪造哈希、无授权零发送断言，不全局放宽。
- 类型检查通过。生产差异为 Escape 监听提交时序及应用版本；需新包补实际 App 流程。原生 CLI/PATH 生产代码未改，适用的 0.1.4 真实回归按源码哈希关联复用。

## 候选包实际复验与 CI 收口

本机新包由 `461fefb536148edbe40e43e585e5f6f3a2b3e1b3` 冻结构建；[原生六项检查](release-0.1.5-evidence/local-candidate/native-smoke.txt)、严格 codesign 检查、[空主页正常退出](release-0.1.5-evidence/local-candidate/empty-startup.json)通过。

[实际浏览器回归](release-0.1.5-evidence/local-candidate/browser-attempt003-verdict.json)通过：真实菜单打开下载面板，菜单项卸载后焦点自然在 body；单次后台 CDP Escape 关闭面板，不移动焦点、不改变下载记录，无 renderer 异常。原进程10032正常 code0/signalnull，准确观察的 PID/TCP 均空；只读库核无 CLI/能力运行、密钥或 AI 快照。这里只复验受影响流程，不冒充在新包重跑全部 M13。

保留[首轮测试守卫失败](release-0.1.5-evidence/local-candidate/browser-attempt001-failed.json)：守卫错误假定仅一个窗口，未进入验收输入；此次未取得正常退出，不计通过。003原始回执证明浏览器确有合法透明后台窗口，守卫改为 PID出生身份、主窗口ID/WebContents/URL与精确后台窗口角色分类。002前置只读打开 SQLite 失败，未启动 App；003仅在无 WAL/SHM、无持有者且完整文件身份与哈希不变条件下使用 immutable 只读核对，未写库恢复。下载记录本身不跨 App 持久化，因此新进程单独准备一次23字节本地附件；旧文件保留，合成任务不增建，没有模型或账号调用。

[候选完整 CI 43735252560](https://github.com/uprxiao/SmartDD/actions/runs/43735252560)有6688项通过、1009项跳过，唯一恢复测试超过5秒（[原日志](release-0.1.5-evidence/candidate-first-ci-failed.txt)）；原浏览器17项全部通过。恢复用例对整份 SQLite Buffer 使用通用深相等，反复逐元素遍历；改为 Buffer.equals 保留逐字节完全一致判据，不增加超时、不改产品逻辑。原文件13项本机通过，耗时13.48秒；修改后13项通过，耗时9.56秒，原 CI 失败场景797毫秒（[结果](release-0.1.5-evidence/read-context-byte-equality-green.txt)）。

[冻结输入核对](release-0.1.5-evidence/local-candidate/test-only-package-reuse.json)证明该次只改一个测试文件，生产源码、依赖、原生组件、配置与候选包哈希未变，复用已验收本机包；最终公开 CI 包另作独立下载与安装核验。

## 待完成

修正后完整 CI、main／新 tag、四平台 Actions、公开资产下载校验和 DMG 隔离安装／正常启动均待实际结果，不预填通过。真实包、凭据和数据库不入 Git，不改日常 /Applications 实例。
