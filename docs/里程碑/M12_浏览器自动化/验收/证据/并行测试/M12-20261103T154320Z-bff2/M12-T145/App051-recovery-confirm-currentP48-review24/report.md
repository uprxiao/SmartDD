# App051 恢复与确认页原图24对复核

已实际逐张查看24对、48张原始PNG（original），每key图像/metadata SHA见 `image-index.json`；未改原图、原raw或原judge。不计整槽、整T145或新增正式通过。

- 恢复16：盾形警告、深色、长警告换行、恢复/清空动作和危险二次确认已实际呈现；body横向无溢出，滚动区外按钮按paintedRect视为被裁剪，没有伪报画面泄漏。
- 确认8：四个disc标记、真实UL/LI、`cookie get`等宽底色已呈现，R1.7按域名整体替换文案同步。仍有确定差异：P代码字为secondary（浅112/深204），A为primary（浅41/深241）；八组均存在。底色/字号/内边距一致。
- 恢复态P克隆启用、A禁用，16组metadata均如此（14组实际painted）。原A业务判据明确needsattention时禁用clone/import，须合同/原型裁定，不能为了贴图启用。
- 恢复警告框A比P短：宽栏2.390625px、窄栏4.78125px；P内联code实测20.4px行高，A未单独采computed。P全局code规则提供可能解释，不能当作A实测事实。
- 窄滚动body实测P430/A434可用宽，dialog最大高度/纵向中心也有差异，逐key保留。完全裁剪控件不算可见，不能把有滚动需求判为溢出，也不以环境名义豁免这些几何差异。

P4px shell、A不同宿主有效高度、源profile与目标名称、P演示页/A真实合成本机页属于明确对照边界；不认证整幅Native页像素。强调范围未有逐字DOM/图像证据，不新增strong范围缺陷。恢复使用显式合成key/cipher/journal/NativeStore故障，不冒真实钥匙串或模型。原R003夹具可见性误判红保留，R004非产品泄漏修复。

逐key判据、精确几何、source行号与原始结果hash在 `review-original24.json`。本复核0 App/Native/HTTP/OS/Node资源，已释放。
