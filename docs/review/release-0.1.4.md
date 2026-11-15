# 0.1.4 整合与发布记录

状态：发布执行中，尚未打 tag 或发布安装包。最终结果以本记录后续实际回执为准。

## 范围与依据

用户明确授权提交、合并 main、打 tag、等待 Actions 和核对 Release；并授权夜间自主完成，次日自行下载试用。版本为同步远端 tags 后的下一版本 0.1.4，发布通道 preview（预发布、非 latest、无 Developer ID 签名及公证）。

- M13 开发与验收交付基线：3a8fa16986de039fb8abd3f8a0648bf53b3d09a6，详细结果见[阶段交付](../里程碑/M13_应用Skill与MCP插件化重构/交付说明.md)。不扩大此前验收平台与用户排除项。
- 合并本机 bugfix 分支的 e1e6b9c37、90bbca0d8，保留 M13 第三方 Claude、插件及恢复测试；合并提交 5ee709f7f。该两项本地提交未因远端 bugfix 分支落后而遗漏。
- 修复此前 CI 43717941423 中 data-only 检查失败：插件安装器不再手写示例模块名，从模块目录计算保留 ID；ZenTao 的既有显式迁移例外保留。未放宽检查规则。

## 检查与限制

实际日志暂存于 `/private/tmp/willyou-release-0.1.4-prep-001`，发版完成时归档适合入库的摘要与证据。

- 类型检查通过；24 项发布与模块规则测试通过；data-only 检查通过。登录 shell 原生检查 4 项通过，生产任务入口 PATH 定向回归 1 项通过（同文件其他 79 项为定向过滤，完整结果取全量测试）。
- 发布候选元数据提交 b2c7d95ee 已推送且远端 SHA 一致；首次推送后 GitHub 未产生 check-run 回执，尚不能计作 CI 通过。后续推送统一显式使用当前 gh OAuth 登录的 Git credential helper，并继续核验实际回执。
- 全量测试、打包回归、main CI、tag 与各平台 Actions、实际下载／隔离安装启动：进行中，未预填通过。
- 首轮 Electron 单测在受限沙箱内出现原生身份读取失败，保留日志；按准确本轮 PID 收尾后改为正常原生进程权限运行，不以首轮结果计通过。
- 不安装到日常 `/Applications/WillYou.app`，不改日常项目、认证、钥匙串或其他进程。系统密码／登录步骤不自动代用户输入。

## 完整 CI 首轮与合同同步

[候选 CI 43721512380](https://github.com/uprxiao/SmartDD/actions/runs/43721512380) 完成全量单测，32 项失败，原日志保留。邮件发送 132 项通过，未把本机高 I/O 并发的 4 个时序失败追认成通过；其独立 5 项定向／配对场景也实际通过。

32 项的实际分类与修复：

- 22 项旧夹具在内置插件初始化（catalog revision=1）后仍传 0：读取真实当前修订，保留 CAS 冲突保护与全部业务断言。
- 5 项迁移测试仍假定末条为 0030：真实恢复至 0035 的列结构与 watermark，再核对 0036 补回 deleted_at，保留浏览器表与业务数据。
- 1 项 RPC 精确名单遗漏三个发送核验端点：补端点及主窗口／子帧／已销毁窗口的授权和原样参数检查。
- 1 项共享执行器测试误调用已经分离的本地 UI 分页读：改为真正的 UI capability 入口，仍严格断言两次 executor／backend 调用及两侧 caller 身份。
- 3 项 shell 测试只写了 zshrc/bashrc，CI 使用 bash 登录 shell：补私有 bash_profile，保留裸 PATH 和解释器发现断言。

集中复验 79 项通过；bash 环境定向 6 项通过（139 项因过滤未执行，不重复计数）；类型检查通过。该批仅修改九份测试文件，生产代码未变，已核 [App 复用依据](release-0.1.4-evidence/test-only-package-reuse.json)，不重复打包。

新包的签名完整性、六项原生组件和空主页启动／正常退出通过，见 [启动结果](release-0.1.4-evidence/candidate-empty-startup.json)。Dock 首次驱动在项目创建后未实际选择项目，任务尚未创建即超时，正常收尾；保留 [原失败](release-0.1.4-evidence/dock-001-driver-failure.json)，后续仅修私有驱动，复用既有项目，不重 seed 或重建 App。

## 发布结果

待实际执行后填写 tag、发布提交、CI／Actions、Release、资产校验及安装启动结果。
