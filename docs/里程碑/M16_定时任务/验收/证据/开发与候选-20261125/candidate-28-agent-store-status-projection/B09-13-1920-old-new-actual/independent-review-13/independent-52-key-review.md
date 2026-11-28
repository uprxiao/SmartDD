# B09 1920×1080：13态、52键独立视觉复核

**结论：52/52 当前候选目标通过，0 个未解决目标差异。** 这是当前 A（真实打包 App）范围，不是 B09 整条或系统 S 的通过。

104 张主取证图（15 张留存旧图 + 37 张当轮旧图 + 52 张当轮 C28 图）；核验 224 个实际独立 PNG/JPEG（含辅助图）SHA；52/52 精确命中原 S1 键及原判据来源哈希；52/52 panel/viewport/address 几何差零；12 对分层原生图完全一致。
两侧实际隔离初始数据为空，两次本机真实外接屏全屏前置达标，正常退出（code 0 / signal null），最终 secret/providerSecret 均为 0；合成1 MiB 文件保留、身份回到clean且无pending、更改不触碰日常实例。

方法：逐个查看26张深/浅目标对照板，每板含480/900两条；左旧、右C28。含原生分层时只按原包所属WebContents矩形装配，属衍生联系板；原始哈希及真实回执独立复核，不把全图像素是否相同当唯一判据。

## 关键差异及历史依据

- C20 hover、C23 keyboard：旧共享tooltip不完整已知，当前完整标题、URL、预览、滚动边界和焦点回执满足原目标。不同录制时刻不是回归。
- C19/C21 原双包视觉、C23六态原真实修复与C24小按钮原样式修复用于判定。C28模态458/537/500等恢复原M12 S1尺寸，旧缺少边框/次级样式及1–2px高度并非应保留的标准。
- B02真实本地HTTP慢请求、Stop关闭未完成响应，原页面同文档恢复；进度时相和fixture query是允许差异。

## 逐52键结果

| 原S1键 | 旧图来源 | C28目视及实际判据 | 已知/允许差异 | 对照板 | 结论 |
|---|---|---|---|---|---|
| dark-rw480-win1920x1080\|R01-11-launcher-empty | 原保留 | 空启动页的工具/文件⌘P、推荐、无访问说明完整；窄宽换行正确，地址空、无网页。 | 两边目标一致。 | [R01-11-launcher-empty-dark.png](R01-11-launcher-empty-dark.png) 第1行 | **通过 A** |
| dark-rw900-win1920x1080\|R01-11-launcher-empty | 原保留 | 空启动页的工具/文件⌘P、推荐、无访问说明完整；窄宽换行正确，地址空、无网页。 | 两边目标一致。 | [R01-11-launcher-empty-dark.png](R01-11-launcher-empty-dark.png) 第2行 | **通过 A** |
| light-rw480-win1920x1080\|R01-11-launcher-empty | 原保留 | 空启动页的工具/文件⌘P、推荐、无访问说明完整；窄宽换行正确，地址空、无网页。 | 两边目标一致。 | [R01-11-launcher-empty-light.png](R01-11-launcher-empty-light.png) 第1行 | **通过 A** |
| light-rw900-win1920x1080\|R01-11-launcher-empty | 原保留 | 空启动页的工具/文件⌘P、推荐、无访问说明完整；窄宽换行正确，地址空、无网页。 | 两边目标一致。 | [R01-11-launcher-empty-light.png](R01-11-launcher-empty-light.png) 第2行 | **通过 A** |
| dark-rw480-win1920x1080\|B03-invalid-address | 原保留 | 实输非法地址后，原生页面停泊时中央三角提示、标题/说明/错误码均清晰，选中地址可见；窄宽均未遮挡。拒绝当下实际驱动已断言文档与tabs不变，正常重输原有效网址后同WebContents恢复（新timeOrigin）。 | 两边目标一致；局部 fixture 地址非视觉判据差异。 | [B03-invalid-address-dark.png](B03-invalid-address-dark.png) 第1行 | **通过 A** |
| dark-rw900-win1920x1080\|B03-invalid-address | 本轮实拍 | 实输非法地址后，原生页面停泊时中央三角提示、标题/说明/错误码均清晰，选中地址可见；窄宽均未遮挡。拒绝当下实际驱动已断言文档与tabs不变，正常重输原有效网址后同WebContents恢复（新timeOrigin）。 | 两边目标一致；局部 fixture 地址非视觉判据差异。 | [B03-invalid-address-dark.png](B03-invalid-address-dark.png) 第2行 | **通过 A** |
| light-rw480-win1920x1080\|B03-invalid-address | 本轮实拍 | 实输非法地址后，原生页面停泊时中央三角提示、标题/说明/错误码均清晰，选中地址可见；窄宽均未遮挡。拒绝当下实际驱动已断言文档与tabs不变，正常重输原有效网址后同WebContents恢复（新timeOrigin）。 | 两边目标一致；局部 fixture 地址非视觉判据差异。 | [B03-invalid-address-light.png](B03-invalid-address-light.png) 第1行 | **通过 A** |
| light-rw900-win1920x1080\|B03-invalid-address | 本轮实拍 | 实输非法地址后，原生页面停泊时中央三角提示、标题/说明/错误码均清晰，选中地址可见；窄宽均未遮挡。拒绝当下实际驱动已断言文档与tabs不变，正常重输原有效网址后同WebContents恢复（新timeOrigin）。 | 两边目标一致；局部 fixture 地址非视觉判据差异。 | [B03-invalid-address-light.png](B03-invalid-address-light.png) 第2行 | **通过 A** |
| dark-rw480-win1920x1080\|B11-grants-empty | 原保留 | 浏览器内模态圆角、边界、层次、空授权提示、完成和关闭都清晰，预览内容不侵入。 | C24已复验按钮样式恢复；现完成按钮更紧凑、副关闭恢复次级样式；模态由214至213px，非新增退化。 实测旧→新447×214→447×213。 | [B11-grants-empty-dark.png](B11-grants-empty-dark.png) 第1行 | **通过 A** |
| dark-rw900-win1920x1080\|B11-grants-empty | 本轮实拍 | 浏览器内模态圆角、边界、层次、空授权提示、完成和关闭都清晰，预览内容不侵入。 | C24已复验按钮样式恢复；现完成按钮更紧凑、副关闭恢复次级样式；模态由214至213px，非新增退化。 实测旧→新480×214→480×213。 | [B11-grants-empty-dark.png](B11-grants-empty-dark.png) 第2行 | **通过 A** |
| light-rw480-win1920x1080\|B11-grants-empty | 本轮实拍 | 浏览器内模态圆角、边界、层次、空授权提示、完成和关闭都清晰，预览内容不侵入。 | C24已复验按钮样式恢复；现完成按钮更紧凑、副关闭恢复次级样式；模态由214至213px，非新增退化。 实测旧→新447×214→447×213。 | [B11-grants-empty-light.png](B11-grants-empty-light.png) 第1行 | **通过 A** |
| light-rw900-win1920x1080\|B11-grants-empty | 本轮实拍 | 浏览器内模态圆角、边界、层次、空授权提示、完成和关闭都清晰，预览内容不侵入。 | C24已复验按钮样式恢复；现完成按钮更紧凑、副关闭恢复次级样式；模态由214至213px，非新增退化。 实测旧→新480×214→480×213。 | [B11-grants-empty-light.png](B11-grants-empty-light.png) 第2行 | **通过 A** |
| dark-rw480-win1920x1080\|B12-profiles-default | 原保留 | 默认登录态选中、当前使用禁用、克隆/导入、无导入记录、证书例外/站点权限为空；模态未溢出。 窄窗导入按钮文字两行，未裁切。 | C24恢复选中背景、按钮边框与关闭/完成样式；窄导入两行、宽单行正确；模态高度恢复而非匹配旧缺陷。 实测旧→新447×564→447×562。 | [B12-profiles-default-dark.png](B12-profiles-default-dark.png) 第1行 | **通过 A** |
| dark-rw900-win1920x1080\|B12-profiles-default | 本轮实拍 | 默认登录态选中、当前使用禁用、克隆/导入、无导入记录、证书例外/站点权限为空；模态未溢出。 宽窗导入文字单行完整。 | C24恢复选中背景、按钮边框与关闭/完成样式；窄导入两行、宽单行正确；模态高度恢复而非匹配旧缺陷。 实测旧→新760×469→760×468。 | [B12-profiles-default-dark.png](B12-profiles-default-dark.png) 第2行 | **通过 A** |
| light-rw480-win1920x1080\|B12-profiles-default | 本轮实拍 | 默认登录态选中、当前使用禁用、克隆/导入、无导入记录、证书例外/站点权限为空；模态未溢出。 窄窗导入按钮文字两行，未裁切。 | C24恢复选中背景、按钮边框与关闭/完成样式；窄导入两行、宽单行正确；模态高度恢复而非匹配旧缺陷。 实测旧→新447×564→447×562。 | [B12-profiles-default-light.png](B12-profiles-default-light.png) 第1行 | **通过 A** |
| light-rw900-win1920x1080\|B12-profiles-default | 本轮实拍 | 默认登录态选中、当前使用禁用、克隆/导入、无导入记录、证书例外/站点权限为空；模态未溢出。 宽窗导入文字单行完整。 | C24恢复选中背景、按钮边框与关闭/完成样式；窄导入两行、宽单行正确；模态高度恢复而非匹配旧缺陷。 实测旧→新760×469→760×468。 | [B12-profiles-default-light.png](B12-profiles-default-light.png) 第2行 | **通过 A** |
| dark-rw480-win1920x1080\|B14-settings | 原保留 | Bing默认、两身份选项及清理后身份选中，下载位置、1.0 MB合成文件、清理入口/完成/关闭完整。 | C24恢复清理按钮边框及完成/关闭样式；458px符合原目标，旧459px。 实测旧→新447×459→447×458。 | [B14-settings-dark.png](B14-settings-dark.png) 第1行 | **通过 A** |
| dark-rw900-win1920x1080\|B14-settings | 本轮实拍 | Bing默认、两身份选项及清理后身份选中，下载位置、1.0 MB合成文件、清理入口/完成/关闭完整。 | C24恢复清理按钮边框及完成/关闭样式；458px符合原目标，旧459px。 实测旧→新480×459→480×458。 | [B14-settings-dark.png](B14-settings-dark.png) 第2行 | **通过 A** |
| light-rw480-win1920x1080\|B14-settings | 本轮实拍 | Bing默认、两身份选项及清理后身份选中，下载位置、1.0 MB合成文件、清理入口/完成/关闭完整。 | C24恢复清理按钮边框及完成/关闭样式；458px符合原目标，旧459px。 实测旧→新447×459→447×458。 | [B14-settings-light.png](B14-settings-light.png) 第1行 | **通过 A** |
| light-rw900-win1920x1080\|B14-settings | 本轮实拍 | Bing默认、两身份选项及清理后身份选中，下载位置、1.0 MB合成文件、清理入口/完成/关闭完整。 | C24恢复清理按钮边框及完成/关闭样式；458px符合原目标，旧459px。 实测旧→新480×459→480×458。 | [B14-settings-light.png](B14-settings-light.png) 第2行 | **通过 A** |
| dark-rw480-win1920x1080\|B14-settings-restart | 原保留 | 真实选中原生身份，重启提示及browser identity set可读，两选项、下载/文件项、清理/完成完整，无挤出。 | C24同类样式恢复；537px符合原目标，旧538px。实际选择回退，未重启。 实测旧→新447×538→447×537。 | [B14-settings-restart-dark.png](B14-settings-restart-dark.png) 第1行 | **通过 A** |
| dark-rw900-win1920x1080\|B14-settings-restart | 本轮实拍 | 真实选中原生身份，重启提示及browser identity set可读，两选项、下载/文件项、清理/完成完整，无挤出。 | C24同类样式恢复；537px符合原目标，旧538px。实际选择回退，未重启。 实测旧→新480×538→480×537。 | [B14-settings-restart-dark.png](B14-settings-restart-dark.png) 第2行 | **通过 A** |
| light-rw480-win1920x1080\|B14-settings-restart | 本轮实拍 | 真实选中原生身份，重启提示及browser identity set可读，两选项、下载/文件项、清理/完成完整，无挤出。 | C24同类样式恢复；537px符合原目标，旧538px。实际选择回退，未重启。 实测旧→新447×538→447×537。 | [B14-settings-restart-light.png](B14-settings-restart-light.png) 第1行 | **通过 A** |
| light-rw900-win1920x1080\|B14-settings-restart | 本轮实拍 | 真实选中原生身份，重启提示及browser identity set可读，两选项、下载/文件项、清理/完成完整，无挤出。 | C24同类样式恢复；537px符合原目标，旧538px。实际选择回退，未重启。 实测旧→新480×538→480×537。 | [B14-settings-restart-light.png](B14-settings-restart-light.png) 第2行 | **通过 A** |
| dark-rw480-win1920x1080\|B14-settings-clear-confirm | 原保留 | 红色影响范围警示、确认清理/取消/完成/关闭可区分；未遮挡，真实取消结束。 | C24恢复红色确认及普通取消各自边框；500px符合原目标，旧501px；未触发破坏性清理。 实测旧→新447×501→447×500。 | [B14-settings-clear-confirm-dark.png](B14-settings-clear-confirm-dark.png) 第1行 | **通过 A** |
| dark-rw900-win1920x1080\|B14-settings-clear-confirm | 本轮实拍 | 红色影响范围警示、确认清理/取消/完成/关闭可区分；未遮挡，真实取消结束。 | C24恢复红色确认及普通取消各自边框；500px符合原目标，旧501px；未触发破坏性清理。 实测旧→新480×501→480×500。 | [B14-settings-clear-confirm-dark.png](B14-settings-clear-confirm-dark.png) 第2行 | **通过 A** |
| light-rw480-win1920x1080\|B14-settings-clear-confirm | 本轮实拍 | 红色影响范围警示、确认清理/取消/完成/关闭可区分；未遮挡，真实取消结束。 | C24恢复红色确认及普通取消各自边框；500px符合原目标，旧501px；未触发破坏性清理。 实测旧→新447×501→447×500。 | [B14-settings-clear-confirm-light.png](B14-settings-clear-confirm-light.png) 第1行 | **通过 A** |
| light-rw900-win1920x1080\|B14-settings-clear-confirm | 本轮实拍 | 红色影响范围警示、确认清理/取消/完成/关闭可区分；未遮挡，真实取消结束。 | C24恢复红色确认及普通取消各自边框；500px符合原目标，旧501px；未触发破坏性清理。 实测旧→新480×501→480×500。 | [B14-settings-clear-confirm-light.png](B14-settings-clear-confirm-light.png) 第2行 | **通过 A** |
| dark-rw480-win1920x1080\|B01-02-tab-hover | 原保留 | 实际 hover 选中标签，C28可见全部长标题含末尾、长URL换行与滚动边界，正确锚定、真实原生绿色页面预览；不侵出工作区。 | 原旧版已知没有完整自定义tooltip；C20/C23修复生效。截图并非同时显示滚动区所有URL字符；实际文本完整由回执证明。 | [B01-02-tab-hover-dark.png](B01-02-tab-hover-dark.png) 第1行 | **通过 A** |
| dark-rw900-win1920x1080\|B01-02-tab-hover | 本轮实拍 | 实际 hover 选中标签，C28可见全部长标题含末尾、长URL换行与滚动边界，正确锚定、真实原生绿色页面预览；不侵出工作区。 | 原旧版已知没有完整自定义tooltip；C20/C23修复生效。截图并非同时显示滚动区所有URL字符；实际文本完整由回执证明。 | [B01-02-tab-hover-dark.png](B01-02-tab-hover-dark.png) 第2行 | **通过 A** |
| light-rw480-win1920x1080\|B01-02-tab-hover | 本轮实拍 | 实际 hover 选中标签，C28可见全部长标题含末尾、长URL换行与滚动边界，正确锚定、真实原生绿色页面预览；不侵出工作区。 | 原旧版已知没有完整自定义tooltip；C20/C23修复生效。截图并非同时显示滚动区所有URL字符；实际文本完整由回执证明。 | [B01-02-tab-hover-light.png](B01-02-tab-hover-light.png) 第1行 | **通过 A** |
| light-rw900-win1920x1080\|B01-02-tab-hover | 本轮实拍 | 实际 hover 选中标签，C28可见全部长标题含末尾、长URL换行与滚动边界，正确锚定、真实原生绿色页面预览；不侵出工作区。 | 原旧版已知没有完整自定义tooltip；C20/C23修复生效。截图并非同时显示滚动区所有URL字符；实际文本完整由回执证明。 | [B01-02-tab-hover-light.png](B01-02-tab-hover-light.png) 第2行 | **通过 A** |
| dark-rw480-win1920x1080\|B01-02-tab-keyboard | 原保留 | 实际 Shift+Tab 目标标签2px蓝框，C28短标题/URL tooltip清晰、蓝色真实原生预览；Esc同文档恢复。 | 旧版保有焦点框但缺完整tooltip，属于已知基线问题；当前修复符合原共享提示判据。 | [B01-02-tab-keyboard-dark.png](B01-02-tab-keyboard-dark.png) 第1行 | **通过 A** |
| dark-rw900-win1920x1080\|B01-02-tab-keyboard | 本轮实拍 | 实际 Shift+Tab 目标标签2px蓝框，C28短标题/URL tooltip清晰、蓝色真实原生预览；Esc同文档恢复。 | 旧版保有焦点框但缺完整tooltip，属于已知基线问题；当前修复符合原共享提示判据。 | [B01-02-tab-keyboard-dark.png](B01-02-tab-keyboard-dark.png) 第2行 | **通过 A** |
| light-rw480-win1920x1080\|B01-02-tab-keyboard | 本轮实拍 | 实际 Shift+Tab 目标标签2px蓝框，C28短标题/URL tooltip清晰、蓝色真实原生预览；Esc同文档恢复。 | 旧版保有焦点框但缺完整tooltip，属于已知基线问题；当前修复符合原共享提示判据。 | [B01-02-tab-keyboard-light.png](B01-02-tab-keyboard-light.png) 第1行 | **通过 A** |
| light-rw900-win1920x1080\|B01-02-tab-keyboard | 本轮实拍 | 实际 Shift+Tab 目标标签2px蓝框，C28短标题/URL tooltip清晰、蓝色真实原生预览；Esc同文档恢复。 | 旧版保有焦点框但缺完整tooltip，属于已知基线问题；当前修复符合原共享提示判据。 | [B01-02-tab-keyboard-light.png](B01-02-tab-keyboard-light.png) 第2行 | **通过 A** |
| dark-rw480-win1920x1080\|B01-02-tab-pressed | 原保留 | 实际按住标签，选中/按压色和原蓝焦点框可辨，按压前后target仍同一，页面恢复。 | 两边目标一致，不要求整图像素相等。 | [B01-02-tab-pressed-dark.png](B01-02-tab-pressed-dark.png) 第1行 | **通过 A** |
| dark-rw900-win1920x1080\|B01-02-tab-pressed | 本轮实拍 | 实际按住标签，选中/按压色和原蓝焦点框可辨，按压前后target仍同一，页面恢复。 | 两边目标一致，不要求整图像素相等。 | [B01-02-tab-pressed-dark.png](B01-02-tab-pressed-dark.png) 第2行 | **通过 A** |
| light-rw480-win1920x1080\|B01-02-tab-pressed | 本轮实拍 | 实际按住标签，选中/按压色和原蓝焦点框可辨，按压前后target仍同一，页面恢复。 | 两边目标一致，不要求整图像素相等。 | [B01-02-tab-pressed-light.png](B01-02-tab-pressed-light.png) 第1行 | **通过 A** |
| light-rw900-win1920x1080\|B01-02-tab-pressed | 本轮实拍 | 实际按住标签，选中/按压色和原蓝焦点框可辨，按压前后target仍同一，页面恢复。 | 两边目标一致，不要求整图像素相等。 | [B01-02-tab-pressed-light.png](B01-02-tab-pressed-light.png) 第2行 | **通过 A** |
| dark-rw480-win1920x1080\|B01-02-toolbar-keyboard | 原保留 | 实际逆向键盘导航至启用后退按钮，蓝2px焦点、左箭头可辨，与相邻按钮层次正确。 | 两边目标一致；页面级CDP键盘，不作为系统层键盘证据。 | [B01-02-toolbar-keyboard-dark.png](B01-02-toolbar-keyboard-dark.png) 第1行 | **通过 A** |
| dark-rw900-win1920x1080\|B01-02-toolbar-keyboard | 本轮实拍 | 实际逆向键盘导航至启用后退按钮，蓝2px焦点、左箭头可辨，与相邻按钮层次正确。 | 两边目标一致；页面级CDP键盘，不作为系统层键盘证据。 | [B01-02-toolbar-keyboard-dark.png](B01-02-toolbar-keyboard-dark.png) 第2行 | **通过 A** |
| light-rw480-win1920x1080\|B01-02-toolbar-keyboard | 本轮实拍 | 实际逆向键盘导航至启用后退按钮，蓝2px焦点、左箭头可辨，与相邻按钮层次正确。 | 两边目标一致；页面级CDP键盘，不作为系统层键盘证据。 | [B01-02-toolbar-keyboard-light.png](B01-02-toolbar-keyboard-light.png) 第1行 | **通过 A** |
| light-rw900-win1920x1080\|B01-02-toolbar-keyboard | 本轮实拍 | 实际逆向键盘导航至启用后退按钮，蓝2px焦点、左箭头可辨，与相邻按钮层次正确。 | 两边目标一致；页面级CDP键盘，不作为系统层键盘证据。 | [B01-02-toolbar-keyboard-light.png](B01-02-toolbar-keyboard-light.png) 第2行 | **通过 A** |
| dark-rw480-win1920x1080\|B01-02-toolbar-pressed | 原保留 | 实际按住刷新图标，按压底色反馈清楚；释放后真实HTTP GET同标签刷新。 | 两边目标一致。 | [B01-02-toolbar-pressed-dark.png](B01-02-toolbar-pressed-dark.png) 第1行 | **通过 A** |
| dark-rw900-win1920x1080\|B01-02-toolbar-pressed | 本轮实拍 | 实际按住刷新图标，按压底色反馈清楚；释放后真实HTTP GET同标签刷新。 | 两边目标一致。 | [B01-02-toolbar-pressed-dark.png](B01-02-toolbar-pressed-dark.png) 第2行 | **通过 A** |
| light-rw480-win1920x1080\|B01-02-toolbar-pressed | 本轮实拍 | 实际按住刷新图标，按压底色反馈清楚；释放后真实HTTP GET同标签刷新。 | 两边目标一致。 | [B01-02-toolbar-pressed-light.png](B01-02-toolbar-pressed-light.png) 第1行 | **通过 A** |
| light-rw900-win1920x1080\|B01-02-toolbar-pressed | 本轮实拍 | 实际按住刷新图标，按压底色反馈清楚；释放后真实HTTP GET同标签刷新。 | 两边目标一致。 | [B01-02-toolbar-pressed-light.png](B01-02-toolbar-pressed-light.png) 第2行 | **通过 A** |
| dark-rw480-win1920x1080\|B02-loading-stop | 本轮实拍 | 真实延迟请求未完成时显示Stop叉、蓝色2px进度条，地址栏及其他图标保持布局；停止后恢复原页面。 窄窗长地址按栏宽截断。 | 进度相位和两侧本地测试query不同是历史允许差异；非全图相等目标。 | [B02-loading-stop-dark.png](B02-loading-stop-dark.png) 第1行 | **通过 A** |
| dark-rw900-win1920x1080\|B02-loading-stop | 本轮实拍 | 真实延迟请求未完成时显示Stop叉、蓝色2px进度条，地址栏及其他图标保持布局；停止后恢复原页面。 宽窗显示更多本地夹具地址。 | 进度相位和两侧本地测试query不同是历史允许差异；非全图相等目标。 | [B02-loading-stop-dark.png](B02-loading-stop-dark.png) 第2行 | **通过 A** |
| light-rw480-win1920x1080\|B02-loading-stop | 本轮实拍 | 真实延迟请求未完成时显示Stop叉、蓝色2px进度条，地址栏及其他图标保持布局；停止后恢复原页面。 窄窗长地址按栏宽截断。 | 进度相位和两侧本地测试query不同是历史允许差异；非全图相等目标。 | [B02-loading-stop-light.png](B02-loading-stop-light.png) 第1行 | **通过 A** |
| light-rw900-win1920x1080\|B02-loading-stop | 本轮实拍 | 真实延迟请求未完成时显示Stop叉、蓝色2px进度条，地址栏及其他图标保持布局；停止后恢复原页面。 宽窗显示更多本地夹具地址。 | 进度相位和两侧本地测试query不同是历史允许差异；非全图相等目标。 | [B02-loading-stop-light.png](B02-loading-stop-light.png) 第2行 | **通过 A** |

## 适用边界

- 52键仅当前1920×1080实际外接屏DPR1/zoom1、深浅主题、480/900浏览器宽、当前13个A目标；不能代替其余B09、其他尺寸、S系统级物理键盘/焦点/手感、完整B09验收或全体原456键。本轮联系板为目标裁剪，单独native层有明确来源，不是新compositor截图。
- 原始AppKit两侧fullscreen/foreground启动前置逐一核验；页面交互可使用已登记CDP焦点模拟，单张shell抓取不单独声明系统真实焦点持续。
- 当前B14仅nondestructive清理确认/取消、真实身份选择后还原；未执行实际删除/应用重启。
- 原旧15图沿用原失败前通过原图及回执，原失败与边界不改写；不把旧tooltip不足当本轮新候选故障。
- 逐态原S1目标判据引用原有人工/原图审阅证据；本轮不声称重新目视全部历史456张原截图。

逐键原裁判对象、文件SHA、原生图配对、几何、实际UI回执见 [independent-52-key-review.json](independent-52-key-review.json)。原失败及公共验收账未修改。
