# DEV154 PPTX 写入失败、重试与关闭保护

依据R3.4/R3.4-P1、M9-T-J04、R07.11/R07.9，2026-10-20。feature/0.0.1，HEAD89de9af4b631abdef5673ce8949fb02a32f6fcad加已恢复工作区。J04由未执行转通过：262/419（62.53%），154未执行、3阻塞；未完成、未发布。

## 当前验证

| 层 | 实际验证 |
| --- | --- |
| U/I | 53全过0skip：19PptxBuffer、6草稿、23实际Worker/服务＋内存持久化适配、2真实native保存幂等、1真实串行保存以及2新FileBuffer/PptxBuffer/完整FileService/r90Worker/native写入故障。共2新、51回归，不把51回归算新正式用例 |
| A | 正常r90浅深各两流程，共4组；原鉴权及原消息不改。写失败→新notes真实checkpoint→冻结自动write→关闭重试真实失败并拦截→显式保存最新→正常关闭并重开；非法图表1,→原始输入草稿、flush失败且0write/关闭拦截→15,27修正保存关闭 |
| 独立读取 | 只读ZIP/XML先沿活动幻灯片chart r:id读实际图表缓存；再用独立系统Python脚本对1原基线和4最终PPTX沿chart externalData到工作簿指定sheet/range比较缓存与嵌入数值，5份都相同。读取前后dev/inode/hash/size/mtime/ctime不变；notes只改目标部件，chart复制部件再切引用，其余原部件按明确闭包全hash保留 |
| 清理 | 8原save调用（4真Permission denied/4成功）、4故障源hash不变、目录模式每次0555→0755；6保留PPTX Worker线程退出，7原RPC和原watch帧恢复，零renderer异常，最终App正常0/null。4自有App已知PID及临时project/userData token都不存在，所有目录0755 |
| 包边界 | 生产/P/native/依赖/配置/版本均未变，沿用r90/0.0.5/macOS arm64；当前82运行JS/CSS/HTML与包内逐hash一致，重新验证DEV153报告73项hash及App/native。沿用原6smoke，不声称重新打包/新P/V或其他平台通过 |

R07.11规定失败冻结自动写入。后续schedule保持恢复checkpoint，用户显式保存或关闭时save触发新串行重试；新输入不会抹去失败或偷偷无限重写。本条不宣称仅打字就解冻自动写，原用例步骤/预期不改。

## 校验过程中的错误与纠正

1. 最初新native夹具chmod源文件使ctime改变，得到正确的版本/身份拒绝，而非所需IO写失败；还存在新closeDocument适配未返回Promise和当前draft.pending为数组的夹具断言错误。初次19绿/2红保留。改为临时父目录0555，原文件版本未变，native返回真实`create volume transaction: Permission denied`。当前53全过。
2. 首App20s观察期结束时，实际排版/table-layout占用共享native作业队列，原保存调用尚在途，不能当已失败或已通过。进程清理使原handler finally未完成，额外恢复自有目录0755留证；新观察器在异常清理先恢复在途fault目录。
3. 次App首个真实写失败通过，随后关闭保护10s观察期不足；等待改为90s但仍须原真实回执和dialog状态，未改生产timeout或队列。实际保存/关闭常需约20–30s排版队列，本轮未做性能合格声明。
4. 第三App一组完整write通过，chart修正实际已保存并clean，但读取器错读被保真的孤立chart1.xml/旧3,4。只读复核活动引用rIdWillYouChart1到willyou-chart-1.xml是15,27。改读取器沿引用，原部件仍保留；重新跑完整浅深4组后才通过，不仅把旧failed结果改写绿。
5. 后置独立嵌入工作簿读取器最初把`/xl/...` OPC包绝对关系拼为xl/xl；红读回留存，修正包根路径解析，系统Python最终5份核对通过。仅校验器变更，未动源数据或App。

## 工程与证据

1322恢复输入＝DEV153的1318＋4新测试源码；父输入仅共用CDP流程改变，最终delta5文件，生产输入逐hash不变。新增[`office-save-observer.mjs`](../../../../scripts/lib/office-save-observer.mjs)、[`pptx-retry-ui.mjs`](../../../../scripts/files/pptx-retry-ui.mjs)、[`verify-pptx-retry.py`](../../../../scripts/files/verify-pptx-retry.py)、[`pptx-retry-native-acceptance.test.ts`](../../../../src/renderer/features/files/office/pptx-retry-native-acceptance.test.ts)。工程恢复链、红/绿原始日志/截图/完整RPC及Worker、原基线与4最终PPTX、只读读回和进程/权限审计归档于[权威报告](../验收/证据/m9-acceptance-pptx-retry-dev154-r90-20261020.json)。报告SHA256 `0674855ef390bbb02147c5f428e1540a4b69b062d658d3823dae717108e965b3`。

共用[CDP流程](../../../真实App自动验收流程.md)补充了父目录IO故障的版本/清理边界、排版队列状态等待与活动关系读取，可供后续阶段复用。本轮无新UI/P变更，J04不约定P/V；不把无原型改动说成重新完成视觉验收。J02基线、J10全部XLSX关闭阶段、W27/W28活动输入/旧回执矩阵未完成，原419+6范围不变，继续独立工作。

归档后的[独立全量校验](../验收/证据/acceptance-pptx-retry-dev154-r90-final/willyou-dev154-final-audit.json)确认65项hash/可逆gzip、1322输入恢复链及仅J04状态变化；[文档更新脚本](../验收/证据/acceptance-pptx-retry-dev154-r90-final/willyou-dev154-docs.py)另存，不回写原始失败。
