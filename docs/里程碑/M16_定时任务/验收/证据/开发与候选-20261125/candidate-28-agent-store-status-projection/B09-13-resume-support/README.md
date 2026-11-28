# B09.2 十三态 1920 续跑：保留 EhnMPS 原15行

这是原 `next-13` 的独立续跑版本。原失败根 `/private/tmp/willyou-m16-b09-c28-1920-pair13-EhnMPS` 原样保留，不复用旧 App 数据，也不重跑已经真实取得并完成各自恢复的15项（四组空launcher，dark480 除 Stop 外11项）。旧包需新取证37行，C28需52行，最终合计104旧新行、52配对键。视觉评审另作，取证行数不是视觉通过数。

## 直接运行

等其他桌面测试释放后，在 SmartDD 仓库根执行。端口3425仍为原合成固定位；确认无其他该 QA 服务占用。下列静态预检不启动应用。

```sh
node release/m16-qa-support/b09-recovery/next-13-resume/preflight.mjs
node release/m16-qa-support/b09-recovery/next-13-resume/driver.mjs --coordinator-authorized-b09-native-fullscreen-resume \
  /Users/liubu/hx/4.uprxiao/SmartDD/release/m16-qa-support/old-reference/WillYou.app \
  697bb2d273a743c22a2d2c2ebc3c509b0fcee3f9c4bbeeb34146c590b2d9afe2 \
  3ea4c07164ebd92391822629e00f4efa4a07a97f33088ef53b3c9b6b532c6040 \
  /Users/liubu/hx/4.uprxiao/SmartDD/release/m16-qa-support/c28/build/mac-arm64/WillYou.app \
  5d715b34f16a31a1edf95692501b58e19e70048bc0f131f4bb33ac1bbcb3ba9e \
  5958e696d973ee8e304333442dc4c55d58402f22a8714af164c6b182fb3d3080 \
  e07fbff84183650e8b3482d8c2499038787c9fd7aea691180cbf86e84fb3aea5 \
  --native-a-fullscreen
```

选用最后的 `--native-a-fullscreen` 时仍按原合法 AppKit 实际前台、精确 PID/程序路径、同一原窗口、三秒稳定、系统失焦即停保护；若自然真实前台未成立，仍等待本人正常全屏。去掉该参数直接沿用本人绿色全屏路径。每包一次：窗口 `WillYou · M16 B09 1920 十三态续跑 旧版 <尾号>` / `... 十三态续跑 C28 <尾号>`，仅将准确测试窗放到1920×1080外屏后绿色全屏。真实 geometry 观察成功后 Agent 自主继续。未将 API 改尺寸算作本人操作或 S。

首条 stdout / `progress.json` 记录本次根。两包串行，旧原 ChildProcess 正常退出0后再启动新包。最终报告 `B09-matrix-1920-additional13-result.json` 明分 `sourceRoot`、`retained`、`retainedOriginal` 和本轮新取证。原 EhnMPS 报告 SHA `83005515d12455853bc155b602b14322830b24c4c9af0ce5eaa11598112c5a49`；静态预检核验所有保留原图、两包、原真实全屏与退出以及固定15键。原失败 B02 截图不计。新旧原图均按原SHA引用，避免伪造合并。因原路径仍在临时目录，归档前保留该原目录。

## 实际失败根因和此次修正

- 原慢 HTTP GET 开始 1795768531567，真实 Stop 点击 1795768531711，连接在 1795768531713 关闭且 `responseCompleted=false`；原 `awaitPage` 第一段的同tab短URL/不loading/无failure已通过，第二段 DOM 条件超时。实际隔离DB保存同一page ID和原短URL。原截图里 Stop 已消失、刷新键恢复；地址显示前缀相同且末端截断，无法从图反推完整 DOM value。
- 原旧/新实际 app.asar 中相同的 `tabAddress` 对已提交网页返回 committed URL；`setAddress(displayedAddress)` effect 只依赖 tabId、displayedAddress、failure，提交尚未成功的新慢URL可能留在地址编辑框。原输入已实证，但原失败现场未保存完整 Stop 后 DOM value；这是源码和原结果联合解释，不把推断写成已观测数据。C23 8次真实 Stop 原判据只要求真实慢连接关闭、同tab/committed URL、不loading。
- 新驱动独立保留实际停止回执、停止前后同原 WC/renderer/timeOrigin/marker、无页面失败、浏览历史与profile保持，并只读捕获完整 DOM value 和正常刷新控件恢复。若仍是精确本次慢URL草稿，正常点击地址框再按 Esc（原产品真实地址编辑取消路径），记录完整前后值和截图；原页面同document必须保持，页面GET次数不得增加。若地址已自动回到原 committed URL，不鼠标/键盘补操作；其他值、目标或仍在加载拒绝恢复。既不重新加载、重新导航，也不改 DOM/store，也不跳过 Stop。
- 旧原失败图为 SHA `96484ac558921727ee33ba706730ff12dc936054fa767b9502b88bb61a82d582`，加载状态原图 SHA `c9d93e6e93f83c8aaf7e973121a11afab125b38342f32042f71ad7b583f0f6c4`。详见 `preflight.json` 原实际输入、只读DB结果、两包源码切片及条件回放；未做第二次实际 App 验证。

完成后运行 `python3 release/m16-qa-support/b09-recovery/next-13-resume/review.py <新根>`。该工具核原报告和两个根真实原件的 SHA，生成派生配对审阅板；没有将图像合成冒作系统 compositor。
