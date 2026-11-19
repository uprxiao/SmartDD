# A67 合并核对及折叠提示

2026-11-19，真实打包 App、原生 Claude 2.1.326／Codex 0.169.0、本机模型夹具。

- [398 旧包](attempt-398/result.json)真实批准、实际 cherry-pick -x、宿主核对通过，展开显示“已核实合入”，折叠后缺少提示。登记 D06-69。修复 3b769ef96；[渲染回归](a67-renderer-green.log) 97 项和[类型检查](a67-typecheck.log)通过。
- [399 Codex 旧驱动](attempt-399/result.json)没有发起权限提升，原生在 linked worktree 写 index.lock 被沙箱拦下。保持原失败，不能计真实冲突。
- [404 新包](attempt-404/result.json) Claude 请求批准下实际合并成功，展开和折叠均显示「合并核对通过」。[展开](attempt-404/02-expanded-merge-outcome.png) · [折叠](attempt-404/03-collapsed-merge-outcome.png)。
- [405 新包](attempt-405/result.json) Codex 请求批准通过两次真实请求批准，合并遇到冲突、暂存修正但不继续。即使没有冲突标记，linked worktree 的 CHERRY_PICK_HEAD 仍被宿主检出，第二次失败显示「需要你处理」。[横幅](attempt-405/02-merge-needs-handling.png)。

404、405 的 App 均正常退出，驱动退出后用普通只读模式查询无 WAL 冷库遇到 SQLite 读取错误。场景界面与 Git 证据保留；[404 独立只读退出核对](404-independent-evidence.json)以已正常退出且无 WAL 的冷库证明六个进程的精确出生身份均已退出，D06-69 关闭。A67 整条仍有其他 Git 和档位组合及 R 层待验。

各次驱动原文以 gzip 保存，解压后字节与运行时源保持一致。
