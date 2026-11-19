# A08 已纳管 Skill 在新任务中可选

2026-11-19，macOS arm64，临时打包候选 `e66f5a85b`，ASAR `7d6df6efc403b7e455789c492bbcc37eae74e13d7729812a75def4e3bdfd6e40`。代码改动在 M14 原生启动前复用 SkillProjectionService，Claude 的按次插件与现有业务插件同时交付，保留 M13 投影边界。查看旧版 [416 红证](../../3b769ef96/A08-managed-skill-catalog/README.md)。

422 使用原两端 CLI、独立数据目录、后台 CDP 和只监听本机的合成模型。先在真实技能页采纳合成来源，再在两端各完成暖机，打开 `$` 选择器并实际选用该 Skill。两个目录和插入操作都通过，原 `SKILL.md` 与相对脚本原始哈希未变。App 退出 0，渲染端无报错。见[结果](result.json)、[Claude](claude-0-menu.png)、[Codex](codex-0-menu.png)。

定向回归 608 项通过、9 项跳过，类型检查通过，独立包 ad-hoc 签名通过。[回归](a08-projection-regression-local.log) · [类型](a08-projection-typecheck.log) · [包内原生冒烟](native-package-smoke.json)。仅归档合成数据。还需独立真实模型执行相对脚本及更新／删除验证，整条 A08 不计通过。完整性见 [SHA256SUMS](SHA256SUMS)。
