# A07 Codex 托管 Skill 发现补充

2026-11-19。原 400 实包的两个 Codex 回合把私有 HOME 的未纳管合成 Skill 元数据送入本机合成供应商。复核了原冷库与 native rollout。两次都未调用该 Skill，原件未改。它和正式采纳、允许共享的 Skill 是不同的来源。[400 冷证据](original-cold-evidence.json)

真实本机 Codex CLI 0.169.0，隔离 stdio app-server，使用不可达的本机 Provider、禁 WebSocket、无 turn、无监听、无凭据。精确的 `skills.config` 禁用当前发现项后，该项不再有效，合成已纳管、宿主库、项目项以及明确授予的额外根仍有效。显式 on-request / user / workspaceWrite 原样返回，原配置、来源和链接未修改。进程均退出 0。[首次发现与禁用](fresh-overlay.json)

已启动后新建另一项，再调用 `skills/list` 强制刷新，能看到晚到项仍有效，旧项仍禁用。这只证明显式刷新的行为。启动时的一次禁用列表不能作为整个托管会话的隔离结论。A07 的托管与订阅矩阵继续待验。[晚到项](late-source.json)

驱动保留为压缩原件。文件哈希见 [SHA256SUMS](SHA256SUMS)。
