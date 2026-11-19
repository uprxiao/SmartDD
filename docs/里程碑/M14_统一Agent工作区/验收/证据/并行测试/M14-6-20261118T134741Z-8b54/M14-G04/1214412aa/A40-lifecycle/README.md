# A40 插件更新、停用和保留数据卸载验收

2026-11-19，macOS 26.6.1 arm64，feature/0.1.6，隔离候选 `1214412aad05bb629e1d9ce7d532755195fe4dca`。实际本机 Claude 2.1.326、真实插件进程和合成模型响应。安装及更新的原生文件夹输入仅接管本轮 App 的精确主窗口和标题。插件变更、批准与页面操作经过正式 App。候选通过六项原生冒烟与 macOS 临时签名校验。 [包和原生哈希](../../../build/candidate-1214412aa/package-1214412aa-sha256.txt)

| 判据 | 本轮结果 |
| --- | --- |
| 新运行与冻结 Skill | 三组均从 App 首页实际创建任务。原生 Skill 清单含插件资源，实际工具使用相对路径读取 1.0.0 内容。更新时旧运行保留旧资源，新运行按最新可用版本加载。 |
| 停用与重新启用 | 211 中同一已发起调用在全局停用后收到原版成功回执，账本仅执行一次。另一运行的新调用收到明确拒绝，尝试数为零。停用时新运行未加载插件，重新启用后原运行沿用同一原生会话、绑定和运行代次，成功再读。D06-57 完成实包复验。 [结果](attempt-211/result.json) · [停用界面](attempt-211/05-disabled-active-version.png) |
| 兼容与不兼容更新 | 212 中两次在途调用分别以 1.0、1.1 结清后活动包才变化。接口 99 包明确拒绝，2.0 删除旧能力时实际显示警告。旧运行按新状态拒绝已删除的能力，旧 Skill 保持原字节，新运行加载对应新资源。 [结果](attempt-212/result.json) · [兼容更新](attempt-212/02-compatible-update-before-release.png) · [不兼容警告](attempt-212/04-breaking-update-warning.png) |
| 保留数据卸载 | 213 通过 App 确认，原回执先结清。旧调用收到 `NOT_FOUND / 插件已卸载`，旧运行仍可读取冻结 Skill。新运行未加载插件，保留数据的前后哈希及项目设置保持一致。 [结果](attempt-213/result.json) · [卸载确认](attempt-213/06-retain-data-uninstall-confirmation.png) |

三批 App 都退出 0。独立只读核验逐条对齐了原始原生工具回执、SQLite、插件子进程结果和已确认退出的 App、CLI、桥与插件进程。 [三批核验](verified-211-213.json) · [旧包红测](../../2b0af2f96/A40-frozen-plugin/README.md)

宿主回执仅在原调用已派发、原运行与租约仍可验证时交付。项目与连接的授权依旧在交付前核对，尚未派发的新调用与缓存回执都要求当前权限。已执行应用服务、插件授权与生命周期、冻结资源和任务启动测试，共 183 项通过，类型检查通过。 [156 项回归](a40-disable-green.log) · [27 项应用服务回归](a40-tool-service-test.log) · [类型检查](a40-disable-typecheck.log)

独立核验脚本绑定本轮的私有路径、原 App 候选以及原始隔离库和原生记录。结果 JSON 保留核验所用数据的哈希。 [脚本](verify-disable-fixed.mjs)
