# 本机 Codex 验收运行说明

本机接续目录 `/Users/hx/hx/hxWork/SmartDD`，分支 `feature/0.0.2`。旧文档中的 `/Users/liubu/Documents/ChatGPT/SmartDD-m10` 属于前一台机器的历史环境；不要求复制该路径或旧 `/private/tmp` 构建。真实 App 驱动规则统一见[公共流程](../../../真实App自动验收流程.md)。

## 环境与版本

2026-10-23 实读系统 Codex 为 `0.163.0`，当前两版适配器声明的验证版本为 `0.162.1`。不修改本机已有 Codex，也不把新版本直接加入受支持清单。当前已从 npm 固定版本在本次私有目录安装并实际验证 `codex-cli 0.162.1`：

```text
/private/tmp/willyou-m10-codex-pin-lq8vtwk1/node_modules/.bin/codex
```

此路径只属于当前机器／本次运行。其他机器在自己的隔离目录准备所需版本，记录 npm 锁定依赖和实际二进制摘要。版本输出、安装成功不证明 Skill／工具／恢复可用；0.163.0 的未验证边界应独立检查。

## 驱动与边界

| 驱动 | 可执行覆盖及前置 |
| --- | --- |
| `scripts/applications/management-ui.mjs` | 实际目录／连接表单／项目显式选用／本地状态／调用记录。只访问本机私有 HTTP／SMTP 夹具；完整真实禅道／Foxmail与外部发收另验。 |
| `scripts/applications/session-ui.mjs` | 实际 P09 固定版本、未知历史、只读诊断、刷新和关闭。`M10_DELIVERY_COPY_FIXTURE=1`增加本批原操作账／未知副本的只读展示断言；真实包运行前须记录源／包哈希。 |
| `scripts/applications/versions-ui.mjs` | 原版本占用与维护 UI 分支，具体完整范围以该脚本及原用例为准。 |
| `scripts/applications/native-codex-resume-ui.mjs` | 实际点击停止／恢复、等待原 run 完成资源释放、保留原生ID与固定包、新 run 握手后读取原草稿；同为私有合成模型。 |
| `scripts/applications/native-codex-unsupported-ui.mjs` | 实读未列入适配器支持范围的0.163.0；验证普通CLI仍可工作且没有M10应用权限，不能据此加入受支持清单。 |
| `scripts/applications/prototype-scope-ui.mjs` | P层：本机静态共享原型的目录／扩展说明／项目选用范围与网络观察。测试包窗口仅承载原型，不计产品A层。 |
| `scripts/applications/native-codex-ui.mjs` | 从历史 T 驱动提取并参数化：实际打包 App 输入→真实 Codex／PTY→原 M10 MCP 创建私有草稿→实际草稿页。模型 Responses 是本机合成夹具；无真实模型推理、外部业务或发信，属于相应层级的局部结果，不能关闭全部真实业务验收。 |

新 Codex 驱动沿用原始脚本及原断言，修改为本仓库公共驱动导入、显式本机包／CLI及ASAR哈希参数、当前Git基线和当前结果路径；自清理驱动环境，只留工具路径／语言等最小变量，HOME／CODEX_HOME／userData均为本次私有目录，不复制日常凭据。原 native TUI notice 的字节变化仍独立记录；不把前一台机器的单独对照当本轮已重跑。

## 本轮运行参数

使用已构建并完成包内原生核对的本机应用。下面为参数形式，`<...>`必须替换为本次实际值，不能原样执行；本轮新包及实际局部结果已记录在[BP验收记录](BP_本机验收与跨机缺项_20261023.md)：P09九项、版本六项、Codex创建六项及停止／恢复八项通过；均按原用例区分局部与完整结果，原生钥匙串阻塞的管理链保持待验。

```sh
WILLYOU_ACCEPTANCE_APP='<本次WillYou.app/Contents/MacOS/WillYou>' \
M10_DELIVERY_COPY_FIXTURE=1 \
node scripts/applications/session-ui.mjs

WILLYOU_ACCEPTANCE_APP='<本次WillYou.app/Contents/MacOS/WillYou>' \
WILLYOU_ACCEPTANCE_ASAR_SHA='<本次app.asar的SHA256>' \
WILLYOU_CODEX_CLI='<本次隔离Codex可执行路径>' \
node scripts/applications/native-codex-ui.mjs
```

系统权限、原生弹窗及实际外部资源按对应原用例补验。Claude Code 的跨机分支见[交接](ClaudeCode跨机验收交接_20261023.md)。用例正文仍是唯一正式结果账，脚本检查点数不累计为通过用例数。失败先保存阶段／原日志，再定位；仅关闭本次 App／PTY／模型夹具，不影响日常实例。

停止／恢复必须等待原run的终态；PTY退出或运行数归零会更早到达。复用恢复驱动中对`applications.session`最近原run的只读状态观察，达到`stopped`后再点击恢复，不直接改租约或重发恢复RPC。UI按钮同时检查原生disabled、aria-disabled／data-disabled与遮挡，错误提示通过只读观察留证。
