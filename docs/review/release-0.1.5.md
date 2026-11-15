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

## 待完成

新候选完整 CI、本机新包回归、main／新 tag、四平台 Actions、公开资产下载校验和 DMG 隔离安装／正常启动均待实际结果，不预填通过。真实包、凭据和数据库不入 Git，不改日常 /Applications 实例。
