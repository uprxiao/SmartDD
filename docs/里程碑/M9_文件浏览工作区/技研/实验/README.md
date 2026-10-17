# M9 独立迁移实验

**P1实验入口（2026-10-17）：** 新增前期实验从[执行账](../../开发前目标与执行记录.md)进入；predev-*目录及文件为本次增量，history与attempt保留失败过程，旧R3.4冻结证据不覆盖。07含真实Claude Code离线输入，但没有Codex运行时访问。

## R3.4 新增记录

本节是最新事实；以下R2/R3“未改生产src”等只描述旧批次。本轮现有App的PTY归属已修，Office/保存等仍为隔离实验；完整M9未交付。旧17份报告及失败/负对照不覆盖，新批次按下列入口单列，不混成全通过率。

| 专项 | 新事实与证据 |
| --- | --- |
| Office / PTY / 保存 | [综合报告](r34-office-pty-save.md)：Office10/10、真实Electron/PTY6/6、保存7通过+1旧缺陷负对照；生产PTY40相关测试及全套定向复验 |
| Office动作/依赖 | [完整动作矩阵与报告](r34-office-actions-矩阵与验证.md)：新检查13通过、1失败。删除被引用sheet的独立计算失败，LO自身往返也复现；保留原件/草稿，不计通过 |
| PDF / Notebook | [报告](r34-pdf-notebook-runtime.md)：18项真实浏览器、16项聚焦模型；真Worker/2000页/CJK/隔离及预算 |
| 原生watch | [报告](r34-watch-原生加载与生命周期验证.md)：固定@parcel/watcher2.5.6，Node与项目Electron各10/10；未作安装包/跨平台结论 |
| LibreOffice 生命周期/成本 | [报告](r34-office-runtime-report.md)：真实DOCX/XLSX/PPTX转换、取消/超时定向清理10/10；不等于复杂Office保真或完整进程树证明 |
| 恢复容量/清理默认 | [额度实验](recovery-quota-result-20261017-r2.json)6/6，默认策略见[综合报告](r34-office-pty-save.md)；实际满盘/断电/生产清理未验 |
| Markdown浏览器Worker | [报告](r34-markdown-worker-report.md)：12/12，当前解析器10MiB实测192.6ms，无主线程≥50ms长任务；取消/超时/真实迟到结果/卸载。尚未接入产品编辑器 |
| TeX真实编译/隔离 | [报告](../../验收/证据/r34-tex-选型与真实隔离验证.md)：固定Tectonic与离线小包12项达到预期；完整LaTeX/CJK/数学资源和生产分发未验 |
| 第三方MCP viewer | [报告](../../验收/证据/r34-provider-capability.md)：官方server-pdf2.0.3的真实HTML、MCP字节与浏览器渲染、只读/隔离/卸载18/18；生产授权/订阅/写回及CLI真正图片仍未验 |


各报告分别列实际覆盖和未验边界，不能将研究候选填成生产能力。全部正式M9用例保持未执行。

## R2/R3 历史实验入口

2026-10-17。这里是研究用脚本、合成输入生成器及实际结果，不是生产文件服务或正式 App 验收。未修改生产 `src`，未安装软件，未读取用户 Office 文件，未操作 Codex 界面。

结论与工程取舍见[实验结论与迁移决策](实验结论与迁移决策.md)，执行环境、历史源码配对及哈希见[机器证据索引](experiment-evidence-index.json)。每份结果 JSON 记录脚本 SHA-256、运行时间、环境/工具版本和实际观察；临时文件、独立 Office profile 和私有管道进程均已清理。

| 脚本 | 用途 | 本次主要证据 |
| --- | --- | --- |
| [filesystem-probe.mjs](filesystem-probe.mjs) | 真实临时文件、跨进程写入/读取、路径与 symlink、revision、atomic rename、watch/poll | [批准本机执行 R3](filesystem-result-20261017-r3.json)、[受限环境与 polling R4](filesystem-result-20261017-r4-sandbox.json) |
| [office-probe.py](office-probe.py) | 用既有 Python/Pandoc 生成自有 OOXML，精确替换标记，经 LibreOffice 同格式/PDF 往返，再独立检查 | [最终 R3](office-result-20261017-r3.json) |
| [anchored-save-probe.py](anchored-save-probe.py) | R3：目录 fd 锚定与交换式提交，重放 FS08/FS09，并保留残余窗口负对照 | [结果](anchored-save-result-20261017.json)：9 通过、1 observed-gap（AFS10） |
| [watch-recovery-probe.mjs](watch-recovery-probe.mjs) | R3：目录级 WatchGuard 的原子替换、事件风暴 resync、降级轮询、权限恢复与释放 | [结果](watch-recovery-result-20261017.json)：6 通过 |
| [engine-cost-probe.mjs](engine-cost-probe.mjs) | R3：markdown-it/KaTeX/js-yaml 在冻结样本上的耗时、Worker 取消/超时/崩溃与损坏输入 | [结果](engine-cost-result-20261017.json)：8 通过 |
| [ooxml-patch-probe.py](ooxml-patch-probe.py) | R3：OOXML 精确补丁（字节级/结构化）与 LibreOffice 整份重写的保真对比，含批注/修订/共享字符串/公式缓存/占位未知部件与宏样部件 | [结果](ooxml-patch-result-20261017.json)：10 通过、3 个对照 observed-gap |
| [pdf-fixtures.py](pdf-fixtures.py) / [pdf-engine-probe.mjs](pdf-engine-probe.mjs) | R3：生成 7 个合成 PDF（正常/200页/加密/截断/随机字节/改名/超大页），用 pdf.js（Node）测解析、文本、链接、大纲、密码、错误、取消 | [结果](pdf-engine-result-20261017.json)：6 通过 |
| [terminal-injection-probe.mjs](terminal-injection-probe.mjs) | R3：真实 PTY＋zsh/cat/sh 验证文件引用文本放入终端输入的安全性（括号粘贴、注入、控制字符、非括号模式、大文本、永不回车） | [结果](terminal-injection-result-20261017.json)：7 通过、1 负对照 |
| [lsp-adapter-probe.mjs](lsp-adapter-probe.mjs) | R3：typescript-language-server 的握手/能力门控/UTF-16 列/过期响应/取消/崩溃/超时/关闭/根外结果 | [结果](lsp-adapter-result-20261017.json)：11 通过 |
| [mcp-adapter-probe.mjs](mcp-adapter-probe.mjs) / [mcp-fake-server.mjs](mcp-fake-server.mjs) | R3：MCP viewer 适配（真实 `rea mcp` 握手，受控服务测 URI/大小/ifMatch/超时/崩溃/洪峰/脏数据） | [结果](mcp-adapter-result-20261017.json)：13 通过 |
| [sftp-provider-probe.mjs](sftp-provider-probe.mjs) | R3：ssh2 回环 SFTP 的主机密钥固定、能力探测、写回降级、基线冲突、断线与挂起 | [结果](sftp-provider-result-20261017.json)：7 通过、2 观察到的缺口 |
| [office-uno-probe.py](office-uno-probe.py) | 现有 LibreOffice 私有 UNO pipe：创建、重开、真正执行文本/单元格/幻灯片编辑、保存、PDF 验证 | [UNO 实测](office-uno-result-20261017.json) |

从仓库根目录运行，输出文件名请另取，保留本次证据：

```sh
node docs/里程碑/M9_文件浏览工作区/技研/实验/filesystem-probe.mjs --output /tmp/m9-files-rerun.json
python3 docs/里程碑/M9_文件浏览工作区/技研/实验/office-probe.py --output /tmp/m9-office-rerun.json
/Applications/LibreOffice.app/Contents/Resources/python docs/里程碑/M9_文件浏览工作区/技研/实验/office-uno-probe.py --output /tmp/m9-uno-rerun.json
python3 docs/里程碑/M9_文件浏览工作区/技研/实验/anchored-save-probe.py --output /tmp/m9-anchored-rerun.json
node docs/里程碑/M9_文件浏览工作区/技研/实验/watch-recovery-probe.mjs --output /tmp/m9-watch-rerun.json
node --expose-gc docs/里程碑/M9_文件浏览工作区/技研/实验/engine-cost-probe.mjs --output /tmp/m9-engine-rerun.json
python3 docs/里程碑/M9_文件浏览工作区/技研/实验/ooxml-patch-probe.py --output /tmp/m9-ooxml-rerun.json
python3 docs/里程碑/M9_文件浏览工作区/技研/实验/pdf-fixtures.py --out /tmp/m9-pdf
node docs/里程碑/M9_文件浏览工作区/技研/实验/terminal-injection-probe.mjs --output /tmp/m9-term-rerun.json
node docs/里程碑/M9_文件浏览工作区/技研/实验/lsp-adapter-probe.mjs --output /tmp/m9-lsp-rerun.json   # 需要仓库外 /tmp/m9-lsp：npm i typescript-language-server@4.3.4 typescript@5.9.3
node docs/里程碑/M9_文件浏览工作区/技研/实验/mcp-adapter-probe.mjs --output /tmp/m9-mcp-rerun.json
node docs/里程碑/M9_文件浏览工作区/技研/实验/sftp-provider-probe.mjs --output /tmp/m9-sftp-rerun.json
node --expose-gc docs/里程碑/M9_文件浏览工作区/技研/实验/pdf-engine-probe.mjs --fixtures /tmp/m9-pdf --output /tmp/m9-pdf-rerun.json
```

R3 三个脚本需要先在 `prototypes/m6-codex` 执行 `npm install`（engine-cost 引用原型的 Markdown 模型）；交换式提交依赖 macOS 的 `renameatx_np`。

脚本不负责安装缺失工具。Office 命令使用当前已有的 `soffice`/`pandoc`/`python-docx`/`openpyxl`/`pypdf`/Poppler；这些实验工具没有被加入 SmartDD 依赖。UNO 脚本当前明确是 macOS 本机路径，并非跨平台实现。未来 CI 必须显式配置受控工具版本。

本次首次受限运行中，目录 watch 未收到事件，LibreOffice 转换异常退出。对相同临时合成数据的 `require_escalated` 自动审批获准后，目录 watch 正常、Office 引擎可运行。没有通过绕开 Codex UI 禁令执行操作；权限条件不同的结果不能混为一条通过记录。受限环境的原生 watch 用例保留失败，polling 用例通过。

历史失败及对应脚本保留：

- 文件 R1 [结果](filesystem-result-20261017.json)/[源码](history/filesystem-probe-r1.mjs)：等待窗口较短；R2 [结果](filesystem-result-20261017-r2.json)/[源码](history/filesystem-probe-r2.mjs)：延长等待后仍收不到目录事件。R3 使用同一 R2 源码、获准本机执行。
- Office R1 [结果](office-result-20261017.json)、R2 [结果](office-result-20261017-r2.json)共用[初版脚本](history/office-probe-r1.py)。R2 获准执行后 XLSX 转换成功，DOCX/PPTX 仍加载失败；最终脚本保留原 OPC namespace 序列化，不再重写无关 XML，R3 三类均可读。不能拿早期加载失败证明格式本身不支持。

`observed-gap` 表示负对照成功复现了方案的限制，不是该安全保障已经通过。文件脚本遇到普通 `failed` 返回非零；Office 脚本的转换完成也不表示保真全部通过，必须读 `unknownPartDropped`、`missingParts`、独立读取及视觉未验证字段。
