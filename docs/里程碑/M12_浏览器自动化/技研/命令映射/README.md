# M12 命令映射（生成脚本说明）

**依据**：[需求](../../需求.md) R02.3（命令集、命名与参数规则）、R02.11（`exec` 白名单）、R06.2（读写语义）。命令条数、读写分类与改写规则**以需求为准**，本页不重复。

**唯一来源**：[gen_command_map.py](gen_command_map.py)。它从 Orca 提交 `bd9455b6165` 的 `src/shared/orca-browser-cli-commands.ts` 与 `src/cli/specs/browser-*.ts` 生成全部产物。产物不要手改；规则变了就改脚本，再重新生成：

```bash
python3 -I gen_command_map.py <orca 仓库> 映射表.generated.md
```

## 产物

| 文件 | 内容 |
| --- | --- |
| [映射表.generated.md](映射表.generated.md) | 逐条对照：Orca 命令与用法、WillYou 命令与用法、参数变化、读写语义、结果交付方式、处理（保留／不适用／新增）、备注；表头给出总数 |
| [exec-allowlist.json](exec-allowlist.json) | `exec` 白名单：放行的 agent-browser 子命令及每个子命令允许的参数 |
| [命令用例对照.generated.md](命令用例对照.generated.md) | 每条命令对应的测试用例编号 |
| [运行时契约](../../../../../src/shared/browser-commands.generated.json) | manifest与主进程共同读取的能力ID、CLI段、读写分类、输入/输出契约、用法和用例；不再维护S1的独立部分清单 |

## 脚本的检查（不通过即失败）

- **命令段**：每条 WillYou 命令为 2–8 段，只用小写字母、数字和连字符；参数名不与 `willyou-app` 的保留字段冲突。
- **用法可解析**：每条 WillYou 用法要能被一份按原生 CLI 规则写的 Python 镜像解析（每个 `--字段` 都必须跟值，不重复）。这只是预检；真实原生 CLI 的解析由测试用例 T030、T031 验证。
- **不残留 `--worktree`**：WillYou 用法里不再出现 `--worktree`。
- **运行时一致性**：保留S1已经使用的能力ID；把`withBrowserPageTarget`动态加入的`--page`写入用法和输入契约；`find`按R04.3补规格漏列的`--name`／`--exact`。这两项只补齐现行需求，不新增命令。
- **用例对照**：每条命令至少对应一条用例，而且这些编号必须真实存在于[测试用例](../../验收/测试用例.md)中。对照只证明“有对应用例”，不证明用例判据充分。

已用反例验证脚本会失败的情况：大写命令段、`--token` 参数、超过 8 段、不带值的开关、不存在的用例编号 `T999`。

## 用户确认记录

- 2026-11-03：`open-url` 不适用；读写分类与 `operation-receipt` 保护。现行条数见需求 R02.3。
