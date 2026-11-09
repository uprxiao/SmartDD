# F01/F03/F04/F29 当前真实入口只读核对

基线：`ed1d4adb7c1bd73fca812833963a50083774a073`，`feature/0.1.1`，工作区 clean。App035/source039 实际 SHA 已重新读取；所审源文件及全部搜索的非测试 renderer 文件与 source039 逐字一致。无 Node/App/Native/系统探针或模型运行，正式新增 0。

| 用户入口 | 当前实际链及关键行 | 结论 |
| --- | --- | --- |
| 文件菜单：适配器／内置／自动 | `workspace-panel.tsx:161–164` → `mcp/viewer.tsx:19–26` → `store.open(...fileViewer)` → `workspace-store.ts:518–555` → `mcp/viewer.tsx:56` → `controller.ts:95` | 已接入。既有合法 ID `default` 的菜单分支直接选择，避免与协议保留字混淆。 |
| 文件“打开方式” | `workspace-panel.tsx:169` → `file-actions.tsx:40/46` → `controller.ts:164–165` → `actions.ts:34–56` → `desktop-actions.inc.mm:73` | 已接入真实 Native 外开，参数为已发现应用 grant，不是 artifact target。 |
| 工作区根目录右键打开方式 | `breadcrumb.tsx:39` → `FileContextActions` 的 `kind:path,directory:true` → 同上 Native | 已接入；不可因没有 `target=workspace` 字段宣称缺入口。 |
| Markdown 本地行列／范围链接 | `markdown/editor.ts:127/210` → `text-editor.tsx:48` → `workspace-panel.tsx:195` → `openRelated:651` → `fileLinkLocation:7–15` → `store.open:664` | 已接入 `line/column/endLine/endColumn`，复用原 tab/ref/buffer。HTTP 链接走系统外开；标题属性／链接文字没有转成 `filePreviewTitle`。 |
| LSP 结果／历史 | `lsp/workspace.ts:84–104` → `workspace.open` 或 `revealSourceRange` | 已接入；不能冒充 artifact source。 |
| 终端 OSC8 | `task-view.tsx:179` → `rpc.app.openExternal` → `main/rpc.ts:77–79` | 只允许 HTTP(S) 系统外开；不是 M9 文件预览入口，file:// 不由此进入工作区。 |
| 任务 Markdown 图片菜单“新标签” | `markdown/image-host.tsx:90/113` → `workspace-panel.tsx:187` → `openRelated(...readOnlyImage)` → `openAttachment:661` → `loadTab:456` | 真正已挂载的 M9 只读图片附件入口，不提供 CSV/TeX、target 或 title。 |
| 邮件原附件／草稿附件 | `applications/workspace.tsx:44` → `activity.tsx:53` / `mail-attachments.tsx:9–15` | 真 UI 已挂载，但为 M10 `ResourceView`／保存动作，不调用 M9 `openAttachment`。 |
| artifact target／预览标题 | `shared/file-navigation.ts:5–15/33–48` → `workspace-store.ts:497–564/583–618` → `file-buffer.ts:49–56` → CSV/PDF consumer | 消费者实现存在；未找到生产 UI 赋值调用者。当前 `src` 没有 `FilePreview` 组件／挂载，不能用组件测试或测试注入当真实 A。 |
| `browser/artifacts` | `core/browser/service.ts:121` → `core/browser/artifacts.ts:16–42` | M12 大结果／图像文件存储与 receipt，不是 M9 artifact viewer 来源。 |

没有充分依据把现有消费者统称“死代码”，也没有本轮产品缺陷或实际 UI 通过结论。`fileOpenOrigin` 是声明／门禁 hint，未见实际生产赋值。Native `FileOpenRequest` 只有路径 capability、只读和附件 hint；title/target 是 renderer 显示意图，不扩大访问权限。

原 F03/F04/F29 的真实来源 A 前置已由用户在 2026-10-23 批准（原账 `source_preconditions`，需求 §1.2／R06.16／末尾来源前置说明）。未落地来源写“条件未触发”，不计该分支通过；其接口／条件 U/I 与现有普通来源步骤仍保留。F01 不套用该前置豁免。

最短下一动作：复用现成 `viewer-navigation-ui.mjs` 的菜单／登记 body 和成熟生命周期，核当前 F01 可触发分支；沿原 PDF Markdown 链接补实际点／范围，不重播已有效 MD/CSV。实际 OS 外开若旧证据适用不足再单列末尾，不能仅检查菜单。target/title、CSV/TeX 附件目前不新造 host；原 `attachment-dispatch-ui.mjs:58` 自己也明确原来源未接入、IPC/native-host 是 I 而非来源 A。完整文件行、哈希、原四合同及逐调用链见同目录 JSON。
