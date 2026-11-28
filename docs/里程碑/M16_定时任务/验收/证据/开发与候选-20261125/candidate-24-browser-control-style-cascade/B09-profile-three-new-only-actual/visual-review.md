# C24 B09.2 登录态控制样式真实复验（2026-11-27）

**本轮新拍12张实际图，复用冻结旧包12张并保留C23失败12张；52个小按钮、12个关闭按钮、4个危险确认的原明确样式全部恢复。原定稿独立/删除确认8个检查点通过；克隆4点只证明真实克隆后手动选中详情，尚不能代替最终原合同的保留源选择状态。**

[实际索引](index.json) · [实际业务与计算样式](support/verified-business-and-style.json) · [精确清场](support/cleanup.json) · [冻结原C23失败与旧包](../../candidate-23-history-projection-idle-clock/B09-profile-three-paired-actual/index.json)。

## 原目标与历史变化

- 最终M12依据：[normal24根判决](../../../../../../M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/normal24-original-contract-closeout-001/root-decision.json)、[App048早期已确认修正](../../../../../../M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App048-normal9-R003-independent-original-review/review-original9.json)、[App051真实最终样式/几何](../../../../../../M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App051-normal15-currentP48-review/metadata-comparison.json)及[旧9适用最终P48](../../../../../../M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App051-normal15-currentP48-review/old9-newP-applicability.json)。早期A039原图是历史真实图，但最终M12明确修复克隆后自动选择新项及内联成功反馈，并以原sonner全局通知维持产品反馈。不能用早期A039替代最后确认状态。
- 所有52个小按钮实测与原明确12px/18px/1px/7px、背景及边色一致；4个危险确认恢复文字#c0392b、边框#e6b0aa；12个关闭恢复13/19.5、50%与secondary。所有操作按钮宽高与原A039相等，宽组26px高，窄组导入安全换行38px，无溢出。
- 当前统一任务宿主根字体14/21、body13/19.5、外部toast均原样保留。与早期A039仍有零边框的computed borderColor差异（无可见边），两张宽clone原图存在按钮hover背景，不是本轮明确样式缺陷。历史A039动作间距8px，最终P48为6px；C24的实际间距及独立/删除8组最终P48框坐标完全一致。
- 与冻结旧和C23的原始RGB对比，所有24个对照的中央/左部、面板上方及右外侧均完全相同；界面差分落在浏览器、已恢复的控制以及toast/阴影时序。逐图看过12组三向原A039/C23/C24对照和4个完整壳图对照。原图DPR差异明确，不要求全PNG像素一致。

## 实际状态与最终目标

| 原矩阵键 | C24 对话框 | 最终P48目标 | 结论 |
|---|---:|---:|---|
| [dark-rw480 · B12-profiles-clone](review/dark-rw480-win1440x900-B12-profiles-clone.png) | 447×594 | 447×562 | 真实clone详情样式通过／最终源选择态待实际 |
| [dark-rw480 · B12-profiles-delete-confirm](review/dark-rw480-win1440x900-B12-profiles-delete-confirm.png) | 447×675 | 447×675 | 原定稿状态、具体样式及业务已通过 |
| [dark-rw480 · B12-profiles-independent](review/dark-rw480-win1440x900-B12-profiles-independent.png) | 447×615 | 447×615 | 原定稿状态、具体样式及业务已通过 |
| [dark-rw900 · B12-profiles-clone](review/dark-rw900-win1440x900-B12-profiles-clone.png) | 760×468 | 760×468 | 真实clone详情样式通过／最终源选择态待实际 |
| [dark-rw900 · B12-profiles-delete-confirm](review/dark-rw900-win1440x900-B12-profiles-delete-confirm.png) | 760×500 | 760×500 | 原定稿状态、具体样式及业务已通过 |
| [dark-rw900 · B12-profiles-independent](review/dark-rw900-win1440x900-B12-profiles-independent.png) | 760×468 | 760×468 | 原定稿状态、具体样式及业务已通过 |
| [light-rw480 · B12-profiles-clone](review/light-rw480-win1440x900-B12-profiles-clone.png) | 447×594 | 447×562 | 真实clone详情样式通过／最终源选择态待实际 |
| [light-rw480 · B12-profiles-delete-confirm](review/light-rw480-win1440x900-B12-profiles-delete-confirm.png) | 447×675 | 447×675 | 原定稿状态、具体样式及业务已通过 |
| [light-rw480 · B12-profiles-independent](review/light-rw480-win1440x900-B12-profiles-independent.png) | 447×615 | 447×615 | 原定稿状态、具体样式及业务已通过 |
| [light-rw900 · B12-profiles-clone](review/light-rw900-win1440x900-B12-profiles-clone.png) | 760×468 | 760×468 | 真实clone详情样式通过／最终源选择态待实际 |
| [light-rw900 · B12-profiles-delete-confirm](review/light-rw900-win1440x900-B12-profiles-delete-confirm.png) | 760×500 | 760×500 | 原定稿状态、具体样式及业务已通过 |
| [light-rw900 · B12-profiles-independent](review/light-rw900-win1440x900-B12-profiles-independent.png) | 760×468 | 760×468 | 原定稿状态、具体样式及业务已通过 |

## 实际业务与资料边界

- 新包一次独立空HOME/data，四个独立project/task，本机同原始静态夹具61917，原实际录制旧/C23图片及归档哈希均核对。12张新原始PNG均为2880×1800，真实1440×900、DPR2，原始PNG保留不编辑。
- 12条闭库 `browser_operations` 精确create/delete/clone owner与ID全部succeeded/completed；4个独立项清除、4个默认及4个clone保留、4标签完成关闭、原历史及原页面WC/PID/doc/viewport恢复通过。0 secret/provider secret/native model sessions；独立核对6个本轮记录PID和4个监听均不存在。
- 克隆详情图在完成克隆后另有真实点击新clone选项。依据最终normal24，须补拍克隆完成但原项目默认仍选中、当前使用禁用且删除动作未出现的四组合；不能把本轮4个手动查看详情点计入完整最终矩阵。此处没有发现该缺陷再次发生，仅当前验收取证缺项。
- C24只恢复浏览器明确控件样式；没有新增完整B09主例通过率或系统层、1920、导入/许可/恢复结论。旧/C23原始图引用，不重复归档。
