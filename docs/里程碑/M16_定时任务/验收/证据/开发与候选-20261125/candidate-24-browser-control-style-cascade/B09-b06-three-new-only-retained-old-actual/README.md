# C24 B09.2：B06 三个原状态实际复验（四个 1440×900 组合）

**独立证据建议：本轮新增支持 3 个原状态 / 12 个实际1440矩阵 key，由协调者统一归账；不在此修改权威通过数。** 旧包12张实测图直接复用，C24新图12张，12 对。Mac arm64、实际 CSS 1440×900、DPR 2；浅/深色 × 480/900 宽。未执行1920×1080或系统层，不主张整幅PNG逐像素一致。

## 原批准目标及实际差异

| 状态 | 复核 | 真实业务与原生责任 |
| --- | --- | --- |
| Basic 认证 | 四组合对话框 447/480×343，原 footer 12px/18px、1px 边、8px 圆角；去掉旧继承样式的14/21、0边、5圆角。原按钮大小/相对坐标、关闭/key图标、输入框焦点边框一致。 | 本机合成401、本来页面实际截图预览、真实Tab/ShiftTab；当前同根1目标WC index0、完整可信shell index1、实际loading且无可见前景页面；真实提交本机合成凭据后同页/WC/profile恢复并读实际 loaded `/auth` sentinel。 |
| 外部应用 | 四组合 41px 高原提示、15px图标、原mini 12/18/1/7，普通取消、蓝色“打开”样式恢复；只捕获提示并取消。 | 实际可信本机合成页面单次click，真实外部请求仅取消；无外部应用启动；原same doc/前景槽位恢复。 |
| 站点权限 | 窄69px/宽41px、15px图标，原按钮和换行恢复。 | 原本机合成位置请求仅拒绝，原页面真实 error1，无成功定位或系统许可；same doc/前景槽位恢复。 |

C24 24 个按钮的7项实际 computed style 和原相对几何均与原批准M12一致。Basic容器继承字体14/21 vs旧M12 13/19.5与 retained old 同，属现有统一宿主非目标差异；可见目标字段及控件布局一致。原不同ICC编码经 sRGB 转换仅单级量化差，CSS原色一致。`review/` 四张实际图衍生三方目标板已逐一查看；原图未转换/裁剪，板仅用于复核。

## 两个真实红仍保留

1. 第一轮旧包：认证提示、真实401和键盘焦点已到位，但驱动错误等待 pending WebContents 的 JS，25秒超时；旧实际截图和原报告SHA保留。最小修正恢复原M12同步native观察。
2. 第二轮旧包12图及业务全绿；C24首次真实提示有预览但驱动仍要求 parked view.visible=false，未记录实际Native条件因而为真实红。最终只运行新包，实际4组合显示正在loading的同WC位于完整可信shell之前（后景），无前景可见native、原尺寸和同身份全部核实；13项条件真实通过。后景可见是冻结C24导航paint持有的正常结构，不以图上预览代替native责任。

## 文件边界

- 根目录24张原实测shell PNG；`review/` 4张衍生三方核对板（原M12通过图只引用，不复制）。
- `support/independent-original-target-review.json`：逐key独立控制样式、相对几何、实际色彩/ICC、焦点、native及业务复核。
- `support/old-actual-selected.json`、`support/new-actual-selected.json`：真实报告白名单投影，可追溯原报告及 driver SHA，非伪造原始报告；`prior-reds/` 保留两轮原实际截图/红结果及哈希。
- `support/actual-cleanup.json`：四个原App PID全部正常exit0、独立ESRCH，三个批次所有已知监听18/18空、私有data句柄4/4空、fixture关闭、最终secret/providerSecret均0。未拷贝数据库、原始日志或凭据（含合成凭据值）。
- `support/*preflight.json`：驱动静态/纯判据结果，不冒充实际；`manifest.json` 和 `SHA256SUMS` 逐文件验真。
