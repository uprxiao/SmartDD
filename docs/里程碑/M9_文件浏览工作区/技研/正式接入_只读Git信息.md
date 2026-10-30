# 只读 Git 信息正式接入

2026-10-17。依据需求 R3.4 / 工程 R3.4-P1 的 R02.8、R05.5、R05.8、R09。延续[迁移方案 §8.1](REA调研与迁移方案.md)，不引入提交、暂存、分支或合并操作。

`FileGitMetadata` 只暴露状态、指定文件行范围的 blame 和取消。调用绑定可信主 frame、根 lease/generation、文档身份及内容 SHA-256。原生 broker 查找当前根或祖先的仓库，验证 `.git`、worktree 指针、公共元数据目录的本机身份和所有者；查询前后重新核对根、仓库与 HEAD。嵌套根输出只包含该根内的路径，恢复对象仍按身份排除。

实际 Git 进程使用系统安装的固定 Git 路径、独立环境、参数数组和原生目录 fd 作为 cwd。禁用 optional locks、fsmonitor、hooks、全局属性/排除、外部 diff、凭据 helper、子模块递归与 lazy fetch。另施加 macOS Seatbelt：禁止文件写入（仅空设备 `/dev/null` 例外）、网络及子进程。需要自定义 clean filter 的仓库明确返回能力不足，不能运行脚本后再称只读。实际测试证明恶意 filter/fsmonitor 未执行且 index 字节未变。取消/超时终止整个 broker 进程组，覆盖其 Git 子进程。

状态采用稳定的 NUL 分隔 porcelain v1，保留中文、空格、换行及重命名路径；最多20,000项、8MiB输出、单原生查询总计12秒。`linguist-generated` 的 set/true、unset/false、未知分别处理；属性不可读不会把未知猜作 false。普通树的隐藏文件行为独立，generated只在变化文件页过滤。协议依据：[git-status](https://git-scm.com/docs/git-status)、[git-check-attr](https://git-scm.com/docs/git-check-attr)。

blame 仅用于与 HEAD 原始字节一致的文件，查询前后核对文件身份和哈希；未提交内容、编码/EOL变换导致原始字节不一致或行号不对应时明确不可用。每次最多400行，按当前可视范围读取；编辑、换源、滚动和关闭淘汰旧响应。CodeMirror保留源码与历史；10ch作者栏、32ch/max42vw弹层依据已归档静态参考 C09/C10。作者、时间、提交说明来自真实结果，不从邮件地址猜登录名或PR。协议依据：[git-blame](https://git-scm.com/docs/git-blame)。

远端只接受不含凭据的 `https://github.com/owner/repo` 或固定Git SSH映射；不给renderer原始remote，路径逐段编码，网页定位使用已校验commit。显示入口不发网络请求；只有明确点击才交既有HTTP(S) opener。

共享原型同步作者栏/弹层设计，数据仍为合成示例。生产实现见 `native/files/git-metadata.inc.mm`、`src/main/core/files/git-metadata.ts` 和 `src/renderer/features/files/git-*.tsx`。实际包与结果见[证据](../验收/证据/m9-development-git-ui-20261017.json)。S02只代表已记录构建；完整M9、其它平台和全部Git场景尚未完成。
