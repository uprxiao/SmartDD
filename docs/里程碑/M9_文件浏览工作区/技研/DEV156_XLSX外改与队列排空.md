# DEV156 XLSX 外改、队列排空与刷新后的公式栏

依据 R3.4 / R3.4-P1、R07.12/R07.5、M9-T-J09；2026-10-20，feature/0.0.1，HEAD `89de9af4b631abdef5673ce8949fb02a32f6fcad` 加工作区。J09 完整 U/I/A 通过，正式 264/419（63.01%），152 未执行、3 阻塞。M9 尚未完成、未发布。

## 实现与缺陷

- **DEV156-OBS01**：原 `OfficeBuffer.refresh` 在 busy/saving 时直接返回，可能丢掉唯一外改通知；stat 返回后仅检查 dirty，无法识别已撤回干净的本地版本变化，重复刷新还会重新加载未解决的冲突。跨自身保存或显式采用磁盘版本的旧 stat 可以覆盖新基线。现刷新前后排空原编辑/保存队列，合并在途刷新，并校验客户端、baseHash 和 bufferVersion；客户端或基线变化重新 stat，本地版本变化/既有冲突均保留原模型，由既有按钮明确解决。
- **DEV156-OBS02**：真实 r92 的 clean 刷新显示新网格，公式栏却为空且只读。新客户端在 loading 时触发选中单元格 effect，因 result 未就绪提前返回；ready 后依赖未变化。`preview.tsx` 补 result state version 依赖，在 ready 时读取真实选区文本，保持旧客户端/选区/模型版本隔离。

沿用现有版本化 OOXML Worker 的等价架构，未引入或宣称实现 CRDT。未改变原型控件、布局、生产原生代码、依赖或版本号；现有 P12/P09 冲突按钮保持。J09 约定 U/I/A，本轮无新 P/V 或 Codex 完整像素一致结论。实际截图仍有既有 Calibri 缺字体兼容提示。

## 验证

| 层级 | 实际结果 |
| --- | --- |
| U | 新 5 条竞态对旧缓冲区全红；旧 stat 跨 Use Disk/自身保存、编辑忙时刷新、输入撤回版本、未解决冲突重复刷新均覆盖。新 delayed loading → ready 组件红复现空公式栏。最终 buffer 23＋preview 27 全过 |
| I | 新 5 条真实 FileService/包内 Worker 测试，独立 Python 同 inode/fsync 写入：clean 刷新新模型；pending 冲突；输入撤回仍冲突；在途原编辑返回排空并明确保留本地；跨自身保存的旧 stat 重读。另 13 会话/失败＋1 物化＋2 W27 原保存回执回归。最终总计 71 全选、0 skip，11 新、60 回归；I 未配置计算 engine，使用真实 cached fallback |
| A | 正常 r93，浅/深各 5 场景，共 10：clean 新网格和公式栏可编辑；pending 外改保留本地；输入后撤回 clean 仍冲突；busy 编辑排空、不覆盖外写，明确 Keep Local 后才保存；旧 stat 跨真实自身保存后重读，不制造假冲突。原 tree/formula/Enter/MetaS/菜单/冲突按钮交互，无 Store 或模型替换 |
| 原始时序 | 仅 race 分支延迟原鉴权 stat/edit 回答，6 门闩原样释放。独立解码 104 原 V8 输出并核对 before/after SHA；4 详细时序证明 busy 的新 stat 在原 edit 返回后、任何保存前发生，以及旧 stat 返回后确实读取自身保存的精确新 hash |
| 源与清理 | 8 次独立外写；6 份 clean/pending/revert 最终文件逐字节等于外写结果，10 份最终源 hash 与记录一致。56 原 watch 帧全被动投递、8 原 RPC 恢复、16 Office 线程退出、0 renderer 异常；3 自有 App 父 PID 和私有 project/userData token 消失，最终正常 0/null。未声称采样全部瞬态原生子进程 |
| 构建 | r92、r93 完整编译和原配置打包；最终 r93 原六 smoke、82 包内运行文件核对、typecheck 通过。macOS arm64 0.0.5 App 目录，无安装器、合并、tag、推送或发布 |

## 失败与验证修正

旧 r91 实机在原 stat 挂起期间输入临时值并撤回 Label，释放原回答后关闭旧模型、显示外写且无冲突，预期冲突超时；原观察器漏记 openOffice 的 path，该次不作为客户端数量断言证据，最终观察器已修正。r92 实机 clean 公式栏超时及组件红均保留，r93 全量复验。

首轮原生 I 4 过/1 失败是适配器漏接 rebaseOffice，补原接口后通过。首轮 r93 的 71 项中 70 过/1 既有订阅降级测试超时：冻结 timeout 时钟只推进 100ms，之后只等真实 I/O，后续 poll 无机会执行。该运输层用例改为真实 watch 时钟并明确暂停自动保存，显式恢复 checkpoint 保留，最终同 71 项全过；生产 watcher 和预算未改，失败的精确异步交错未留记录，不推断更细时序。

## 恢复与接续

1330 工程输入在 r93 构建前全量归档，最终 10 文件 delta 可恢复。构建后仅外部驱动、共用 CDP 方法和既有订阅测试改变，两处生产修复及 native/build/deps 与预快照一致，最终测试已重跑。旧 r92 构建前源码、所有红测、两次失败 App、最终 App、输入/输出文件与驱动均保留。

证据：[DEV156 主记录](../验收/证据/m9-acceptance-xlsx-refresh-dev156-r93-20261020.json)，SHA256 `8043f17840e75aaaccd7a315df418a2bd7c2e175c246289979ea489f828cc392`，104 项不可变归档。方法已加入[共用真实 App 自动验收流程](../../../真实App自动验收流程.md)。仅 J09 新增通过；J02/J10/W28、系统/人工/完整参考及平台边界继续，T32/T34/Y29 三阻塞保留。
