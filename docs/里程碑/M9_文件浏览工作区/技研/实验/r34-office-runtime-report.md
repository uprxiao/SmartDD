# R3.4 LibreOffice 成本、取消与临时资源补证

对应 GAP-09 的 Office 子进程部分，补充既有结构编辑实验。2026-10-17，在 macOS 26.6.1 arm64、已安装 LibreOffice **26.2.4.2** 上，使用新生成合成 DOCX/XLSX/PPTX 和新建临时 profile，最终 **10/10 检查通过**。这不是已打包 WillYou 的验收，也不证明整份 Office 重写保真。

- [最终机器结果、进程采样、输出和清理明细](r34-office-runtime-result.json)
- [探针](r34-office-runtime-probe.py)、[预先固定预算](r34-office-runtime-budget.json)
- [首次运行 8 通过、2 失败记录](r34-office-runtime-result-attempt1.json)
- [已安装 LibreOffice 磁盘占用](r34-office-installed-cost.json)

## 方法和隔离

复用 `ooxml-patch-probe.py` 的合成包生成器，只读取新建临时目录内的输入；XLSX 合成样本在计算基线哈希前明确设置 A 列宽度。大 DOCX 由同一合成包扩成20000段，每段包含唯一序号。每个格式首次使用独立 profile，第二轮复用该 profile；每次都是新 LO 进程。这里的 warm 是“复用 profile/系统缓存”，**不是常驻 UNO worker 的热请求**；没有清空操作系统缓存，cold 也不代表物理磁盘冷缓存。

每次 `Popen(start_new_session=True)` 创建独立进程组，以该 PID/PGID 标识所有权。`ps` 仅读取 PID/PPID/PGID/RSS/state/可执行名，不读取任意进程的命令参数或环境；结果只保留本探针的组。取消向本组发 SIGTERM，最多等待0.6秒；仍存活才向同组发 SIGKILL。没有 `killall`、全局 pkill、接管既有 LO、用户文档或全局配置。最终只删除本探针创建的临时根。

## 实测

预算：单次转换<20秒，自有进程树采样RSS≤1GiB，取消完成<5秒；标称采样间隔50ms，实际间隔包含 `ps` 耗时。RSS为采样最大值，可能遗漏瞬时峰值，不是精确内存上界。转换成功同时要求退出0、PDF真实存在、pdftotext读回明确合成标记、无残留组内进程，而非只看 exit code。

| 输入 | 新 profile 转换 | 复用 profile 转换 | 新/复用 profile 峰值采样 RSS |
| --- | --- | --- | --- |
| DOCX | 1676.56ms | 1021.87ms | 287.19 / 281.53MiB |
| XLSX | 1553.91ms | 893.38ms | 285.45 / 281.66MiB |
| PPTX | 1867.34ms | 1211.90ms | 320.61 / 317.69MiB |

主动取消：大 DOCX 的真实 LO 进程运行约1秒后取消，SIGTERM完成清理 **426.82ms**，退出码255；未发布转换结果，取消任务的输出目录被删除。超时：在真实 LO 自有进程组运行约0.3秒时注入 SIGSTOP，使它无法处理SIGTERM；1.2秒任务期限到达后走 SIGTERM→SIGKILL，清理 **905.67ms**，退出码-9。此项证明有控制的真实进程失响应恢复，不能描述成观察到了自然发生的 LO 卡死。

两条取消检查最终残留组内进程均0；整个实验的四份原始合成输入 SHA-256均未改变。常规转换曾观察到同组 gpgconf 辅助进程并最终退出。两条取消时实际采样到的存活目标均为单个 soffice；定向进程组策略已经运行，但没有伪称取消当时存在多层活跃子进程，也没有证明可发现主动逃离本session/PGID的子进程。

清理前临时目录有240个文件，包含正常 profile 缓存及各 profile 的 `.lock`；**LO 进程退出不等于磁盘无残留**。本探针随后销毁整个自有临时根，复核目录不存在。正式适配器须采用相同的任务所有权与清理策略，不能清理用户全局profile，也不能把取消时的半成品作为已完成产物。

已安装 `/Applications/LibreOffice.app` 的 `du -sk` 为813776KiB，约794.7MiB。它是完整本机安装目录的磁盘分配占用，不是 WillYou 安装包增量或压缩下载大小；本轮没有捆绑该应用，也未改变包依赖与安装流程。

## 失败与复验

首次6次转换均实际生成PDF，但XLSX默认A列宽度将`UNIQUE_LABEL`裁切成`UNIQUE_L`，两项标记断言失败；原始结果保留为8通过、2失败。第二轮只为新生成夹具设置A列宽度28，使读回标记完整；20秒、1GiB和5秒预算及取消逻辑均未放宽。最终10项通过。这个修复是测试夹具的可见性设置，不代表解决了任意电子表格的自动排版/打印保真。

## 复现及剩余边界

```sh
python3 'docs/里程碑/M9_文件浏览工作区/技研/实验/r34-office-runtime-probe.py' --output 'docs/里程碑/M9_文件浏览工作区/技研/实验/r34-office-runtime-result.json'
```

前提是本机现有 LibreOffice、python-docx/openpyxl/lxml/pandoc/pdftotext。脚本和夹具生成器哈希、预算、版本及时间在机器结果中；真实转换需能启动本机应用的执行权限。本轮未再次执行已知会Abort134的沙箱路径，使用已获准的同类隔离转换权限。

剩余：真实安装包中的引擎发现/配置、用户取消入口到所有权令牌的完整链路、应用退出或崩溃后的遗留任务回收、深层/逃离进程组的后代、并发与持续运行负载、Windows/Linux进程树机制、完整渲染保真和Office结构编辑能力矩阵。成本样本每种冷/热各1次，足以作为本轮可行性检查，不能作为普遍时延SLA。正式425条用例的执行状态未由本报告修改。
