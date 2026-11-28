# C24 B09.2 克隆后保留源选择：四点最终原合同实际复验（2026-11-27）

**本轮旧包／C24 各四张实际原图（共八张），四个原矩阵点均完成独立视觉与业务核对。C24 的十二个小按钮、四个关闭按钮与最终实际 App048/051 明确样式一致；原三状态的不同四组合现补齐十二个 1440 点。此处不增加主用例通过数。**

[实际索引](index.json) · [业务与闭库回执](support/actual-business-and-style.json) · [精确清场](support/cleanup.json) · [独立／删除确认八点与此前克隆详情证据](../B09-profile-three-new-only-actual/index.json)。

## 最终原合同与逐图结论

A039 早期克隆详情图保留为历史，不替代最终 normal24。四个本轮克隆点击后没有再选择副本，实际源仍选中、任务独立副本存在、当前页已使用按钮禁用、无删除。逐点查看最终已接受的 App048／051 原始截图、同键最终 P48 原型、实际冻结旧包和 C24 图，共四张四向对照板；另核对两张全壳板。原 A/P 文件均复核源档案哈希。

| 原矩阵键 | 最终 App 原框尺寸／现 P48、C24 框尺寸 | 冻结旧框尺寸 | 结论 |
|---|---:|---:|---|
| [dark-rw480-win1440x900 · B12-profiles-clone](review/dark-rw480-win1440x900-dialog-review.png) | 447×562 | 447×564 | 通过：源选中／副本存在／原控件样式与布局恢复 |
| [dark-rw900-win1440x900 · B12-profiles-clone](review/dark-rw900-win1440x900-dialog-review.png) | 760×468 | 760×469 | 通过：源选中／副本存在／原控件样式与布局恢复 |
| [light-rw480-win1440x900 · B12-profiles-clone](review/light-rw480-win1440x900-dialog-review.png) | 447×562 | 447×564 | 通过：源选中／副本存在／原控件样式与布局恢复 |
| [light-rw900-win1440x900 · B12-profiles-clone](review/light-rw900-win1440x900-dialog-review.png) | 760×468 | 760×469 | 通过：源选中／副本存在／原控件样式与布局恢复 |

[最终 M12 normal24 根判决](../../../../../../M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/normal24-original-contract-closeout-001/root-decision.json)；[App048 已确认修正](../../../../../../M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App048-normal9-R003-independent-original-review/review-original9.json)；[App051 最终实际元数据](../../../../../../M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App051-normal15-currentP48-review/metadata-comparison.json)；[旧9适用最终 P48](../../../../../../M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App051-normal15-currentP48-review/old9-newP-applicability.json)。

## 实际视觉差异判定

- C24 原四点对话框坐标与最终 P48 精确相同。每点最终实际 A 与 C24 的 dialog/body/detail、所有可见按钮及 action 矩形，差值均为 `[x:0, y:+18, width:0, height:0]`；这是 M12 实际宿主到当前统一任务宿主的整体定位变化，不是局部控件偏移。32 个可见按钮及其尺寸精确核对。
- 12 个动作的完整 computed-style 字典、宽高（窄布局导入 145×38，宽布局导入 172.265625×26）与最新实际 A 全部相等，包含克隆 hover 背景；禁用按钮的 0.45 opacity 与 pointer-events:none、关闭的 13/19.5px、50% 圆角和 secondary 色恢复。冻结旧包缺少这些明确的局部作用样式，窄/宽框分别多 2/1px。
- 仍观察到已知历史宿主根 14/21 vs 13/19.5、零宽边框的 computed color 不同，以及原型样例多 WillYou 前缀；实际项目名称与源选中背景在旧/C24/已接受的 A 中一致。无剩余具体目标样式失败。
- 两次捕获读回 global toast 的时间、位置和偶尔可见栈数量不同；只比较稳定的控件样式与原定稿状态，并记录动态 toast，未将动态 toast 算作样式放宽或去掉反馈。从原最终 M12 起已批准外部 toast、无内联成功提示。
- 四张实际 old/new PNG SHA 均不同；像素核对显示真实面板左侧、上方、右侧完全不变，差异局限于真实浏览器区域（本轮恢复的控件，以及 toast、阴影时序）。DPR2 实际图与历史 DPR1／原型不强求整图 SHA 相同。

[浅色实际全壳板](review/light-actual-full-shell-overview.png) · [深色实际全壳板](review/dark-actual-full-shell-overview.png)。

## 实际业务、资源与边界

- 两侧独立空 HOME／userData，8 个独立 project/task；每点只真实点击一次克隆，之后完成及关闭对应页，没有选择副本、没有独立新建/删除/应用当前页动作。闭库每侧只有四条 `ui profile clone`，全部 succeeded/completed，准确 actor/source/project，源归项目、副本归任务。两侧各保留四源四克隆，原标签历史按原源记录。
- 八次实际原生页 WC/PID/文档与恢复前后一致，真实 preview 精确内嵌当前 viewport，旧版 park 到透明不可聚焦 background root (2 roots)，C24 保留同 root 但隐藏 native page (1 root)；关闭对话框后原同一页恢复原几何、随后实际标签关闭。
- 原始八张 PNG 均为 2880×1800，真实 CSS 1440×900、DPR2，原图不更改。原始报告、白名单脚本、派生比较板、只读闭库摘要分别归档，不归档真实/日常数据、原始日志、DB 或凭据。
- 两 App 正常退出 code0，独立复核 12 个本轮观测 PID 已 ESRCH、四个本轮私有 CDP/Inspector 端口无 LISTEN。共享合成 3425/61917 由协调者在退出后及下一串行任务前逐端口核空并记录；不干预后续测试。
- 本轮只补最终克隆态四个 1440 原矩阵点。联合此前 [C24 独立／删除八点](../B09-profile-three-new-only-actual/index.json)，三状态十二点完成；此前四张手动选中 clone-detail 图仍只是业务/历史样式证据，不重复计数。1920、S、真实导入账号/权限/恢复不在本轮。
