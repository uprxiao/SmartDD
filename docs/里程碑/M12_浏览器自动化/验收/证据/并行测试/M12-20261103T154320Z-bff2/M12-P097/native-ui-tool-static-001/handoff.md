# Native focus 工具静态核查交接

结论：**可精确选择已运行 PID／window_id 的观察能力已由工具声明证实；取得初始前台的能力尚未证实。** 本任务只读工具元数据和本地 Skill，没有执行 REA/CUA/native/session/App/模型/剪贴板操作，没有领取资源，正式新增 0。

## 已知边界

- `observe_native_ui` 绑定 active Mach-O，按 PID＋window_id 观察已运行窗口；明确 OS 权限失败时不广抓、不启动目标。返回 executable／launch_time／PID／title／window_id 和 target_sha256，可用于核身份；这些字段没有证明每步原子校验 birth。
- `capture_native_ui_scenario` 的 click 文案是 selected-element press，其他动作是增减滚动、AXValue 输入、等待。未声明物理坐标点击、activate 或 raise；是否内部调用 AXPress、是否顺带激活均未知。动作成功不是前台证明。
- 当前 REA 名单未广告原生 window ID 枚举工具。window_id 必须先从本次隔离 App／已支持的原生 inventory 得到；`BrowserWindow.id` 和 NSWindow/NSView 指针不可当 CGWindowID。
- `binary_session({})` 是未来最小只读前置，能返回 active target、busy/provider/capability/effect。当前尚未调用。`open_binary` 有 provider/active database 生命周期，没有 no-GUI／metadata-only／session-ID 参数；不能假定不打开 Hopper 或不替换他人会话。

## 最小未来参数（现在不执行）

资源须先由 root 在 P096 原结果、独立清场之后分配。首先：

```js
await tools.mcp__rea__binary_session({});
```

若是外来 target 或 busy，不切换、不 close。若空／本任务拥有且明确 provider/effect 允许，再决定是否绑定精确 Mach-O：

```js
await tools.mcp__rea__open_binary({
  path: verifiedApp020Executable,
  provider_id: verifiedExplicitProviderId,
});
```

正常 Mach-O 不传 `architecture`／`format`，不自动选 provider、不安装、不导入 snapshot。若 provider/GUI 副作用仍未知，保留缺项。验证精确目标 SHA、PID birth／exe、CG windowID 后，首个原生请求应是 AX-only 被动观察：

```js
await tools.mcp__rea__observe_native_ui({
  pid: verifiedPid,
  window_id: verifiedCGWindowId,
  accessibility: true,
  screenshot: false,
  max_nodes: 80,
});
```

参数变量必须来自本次新隔离实例，不能复用已退出 P096 的 PID。返回 target_sha256／exe／PID／windowID 要全匹配；launch_time 的单位在声明中未知，先核语义再作跨时钟比较。权限拒绝、身份不符或枚举来源不明不能靠扩大捕获、路径启动、日常实例、CDP 或激活变体消解。AX树截断保持部分覆盖；确有需要时，仅可对同一精确窗口有界增加节点预算补核。

现有声明不足以推荐 `capture_native_ui_scenario` 的 click 作为前台修复。若以后有另外证据确认一个动作的确能在精确窗口范围取得前台，仍必须实际通过原 Native frontmost＋可见＋DOM focus 稳定 1 秒，之后只安装一次 guard；不重武装、不重放旧输入。CUA 文档／inventory 后续由 root 在资源空闲时读，本任务没有调用它。

完整发现、未知项、未来步骤在 `result.json`，工具原声明在 `tool-metadata.json`，本地来源哈希／摘录在 `sources.json`。此交付不构成前台绿测或任何原 A/R/S 通过。
