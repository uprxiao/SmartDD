# R3.4 TeX 选型与真实隔离验证

2026-10-17，GAP-09 的 TeX 前期选择；关联需求 R06.6、D02 和技研 A0。结论：**Tectonic 固定引擎＋离线资源包＋独立受限进程**已在本机证明可以真实编译合成 Plain TeX，并实施路径、网络、shell、取消与限时约束。12 项实验全部达到各自预期；其中正常文档真实生成 PDF，资源缺失与非法输入等负对照必须失败。这不等于完整 LaTeX／字体／分发闸门全部关闭。

## 环境、固定版本与来源

- 本机 macOS arm64（精确内核版本见 [JSON](r34-tex-report.json)）；PATH 及 `/Library/TeX/texbin` 等约定位置没有可用 TeX 引擎。Docker CLI 存在，但 daemon 未运行，未启动 Docker。
- 采用官方 [Tectonic 0.17.0 发布](https://github.com/tectonic-typesetting/tectonic/releases/tag/tectonic%400.17.0)的 arm64 macOS 包：下载包 21,704,674 bytes，解出引擎 53,998,928 bytes；官方发布 SHA-256 为 `a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667`，实际匹配。
- 最小离线资源来自同版固定提交 `8c0126a9653239a2e6e0a5274af9b8510f643030` 的 [tests/assets](https://github.com/tectonic-typesetting/tectonic/tree/8c0126a9653239a2e6e0a5274af9b8510f643030/tests/assets)和根 LICENSE。74 个文件逐个核对 Git blob SHA-1，另保存 SHA-256；解压资源 5,729,409 bytes，确定性 zip 1,348,544 bytes，SHA-256 `e7d6f9ab00f368f3530e60555d7a794b74d3ae6bec539dd293481e7aa08d6189`。见[资源清单](r34-tex-assets.json)、[准备元数据](r34-tex-preparation.json)。这是官方测试资源的最小 Plain TeX 包，不能称为完整 TeX Live／LaTeX 包。
- [官方 LICENSE](https://github.com/tectonic-typesetting/tectonic/blob/8c0126a9653239a2e6e0a5274af9b8510f643030/LICENSE)说明 Tectonic 自身使用 MIT，衍生组件涉及多种开源许可证。因此正式分发须逐项记录引擎组件、宏包及字体许可，不能将整个资源包一律标为 MIT。

下载和准备仅发生在独立 `/private/tmp/m9-r34-tex`；未全局安装、未修改 App 依赖。准备阶段可下载明确固定的官方文件，编译进程禁止联网，缺资源不自动下载。Python 默认 CA 配置最初失败后改用系统 curl，始终保留 TLS 证书校验。

## 已选择的执行契约

1. 主进程接受明确“编译 artifact”请求，通过已授权 root lease 读取并复制允许的源码／资源到每任务独立快照；保留目录结构、拒绝越界及未经允许的 symlink。生产 broker 仍需实现，此实验仅使用已知合成快照。
2. 固定 executable、bundle、入口、输出目录和参数，直接 spawn，不接受文档给出的 shell、latexmk 命令或自定义任意参数。CLI 同时带 `--untrusted --only-cached`；环境额外设 `TECTONIC_UNTRUSTED_MODE=1`，不运行项目配置中的命令。官方 CLI 对不可信模式及离线参数的定义见 [compile 文档](https://tectonic-typesetting.github.io/book/latest/v2cli/compile.html)。
3. macOS 实验以 `sandbox-exec` 默认拒绝运行：仅列明系统运行时／根目录目录读取、指定引擎／bundle、该任务快照可读；写入限该任务 output/cache/tmp/home；禁止其他可执行文件、fork 和网络，进程信息仅自身。无全局 `/Users`、`/private/tmp` 或文件 metadata 放行。最终完整 policy 已存 JSON。系统库允许路径是执行引擎所需的显式例外，不表示文档能任意读取用户目录。
4. 宿主为进程设 CPU 3/4 秒、单文件输出 16 MiB、FD 64；普通实验墙钟 15 秒，RSS 轮询超过 256 MiB 杀进程组；取消和超时也杀该独立进程组。RSS 是采样约束而非内核硬内存上限，这组数值是实验配置，尚非冻结的生产预算。
5. 只在任务仍有效且 exit=0、PDF 解析成功、源 revision 一致时交给 PDF viewer；取消／错误不接受可能残留的 PDF。正式输出大小、页数、合法路径与提交校验仍应由 broker 负责，原始源码和错误始终保留。隔离或依赖不可用时显示不可编译，禁止退回不受限编译。

## 真实实验与结果

执行脚本为 [r34-tex-probe.py](../../技研/实验/r34-tex-probe.py)，准备脚本为 [r34-tex-prepare.py](../../技研/实验/r34-tex-prepare.py)。编译调用的是真实 Tectonic，PDF 用 pypdf 解析并提取文本；没有假编译器或预制 PDF 代替。

| 编号 | 实际观察 |
| --- | --- |
| TEX34-01 | 真实 Plain TeX 产生一页 PDF，提取出 `Hello WillYou` 与根内 `inner.tex` 的文字；[PDF](r34-tex-normal.pdf)及其哈希在 JSON |
| TEX34-02 | 数学样本缺物理字体 `cmmi10.pfb`，明确失败、无成功 PDF、不联网补齐；这是预期的资源缺失负对照，不是数学支持通过 |
| TEX34-03–05 | 绝对路径、`../`、根内 symlink 三种读取根外合成 canary 均失败，输出未出现 canary 内容 |
| TEX34-06 | 根外写入失败，原 canary 未改变；即使曾生成部分 PDF，也因非零退出不得接受 |
| TEX34-07 | 人为追加 `-Z shell-escape`，`--untrusted` 仍使 shell 指令不执行，无 marker，正常正文仍能编译 |
| TEX34-08 | 非法 TeX 命令真实报错，源码与诊断保留 |
| TEX34-09–10 | 真实 TeX 死循环分别由超时／取消杀死，无成功 PDF；耗时及峰值 RSS 按本次最终 JSON 记录 |
| TEX34-11 | 同一 OS 策略的 curl 负对照只尝试本机已有 4176 端口，socket 被系统拒绝；未向外部服务发送请求 |
| TEX34-12 | 编译策略仅允许指定引擎，运行其他程序被拒绝 |

最终结果：[r34-tex-report.json](r34-tex-report.json)，12/12 达到预期。资源包、源样本、引擎和 PDF 哈希、实际进程输出、退出码、策略、环境与耗时都在报告／清单中。最初数学编译的实际失败另留 [initial-missing-font](r34-tex-initial-missing-font.json)。早期过窄系统路径策略令 dyld 启动中止；补充根目录只读后解决，再移除全局 metadata、fork、任意设备与其他进程信息权限后重新通过全部 12 项。

## 未关闭事项与后续条件

- 完整 LaTeX 宏包、数学物理字体、CJK／系统字体策略、复杂文档与图片等未完成。当前最小包会对合法但缺资源的文档报错；应准备独立版本化、许可清楚的完整产品资源包并复验，不能在生产编译时临时联网拉包，也不能以这项负对照把用户文档降为不支持。
- macOS 的这份 profile 仅为本机原型证据，正式签名／分发辅助进程及系统版本覆盖须验证；Linux/Windows 需要各自实际可用的隔离适配与负对照。不能沿用 macOS 的 12 项结果宣称跨平台安全。
- 还需生产 root lease、只读快照复制、路径竞争／资源配额、任务/源 revision、错误展示、取消回执、PDF 路由与输出提交；这些不能由临时脚本代替。
- 本轮可将“没有真实 TeX 编译路线证据”推进为“已有固定引擎、离线小包与 macOS 强约束的可行实验”；D02 的完整资源、保真、分发和生产适配仍是工程工作，不要求用户选择编译协议或默认同意跳过 TeX。
