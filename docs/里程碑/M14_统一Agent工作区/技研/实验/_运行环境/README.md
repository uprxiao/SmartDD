# M14 实验运行环境补交

2026-11-16 从原实验电脑收集，目标分支 `feature/0.1.6`。这是历史实验输入补交，不表示重新完成 M14 验证或产品验收。

## 内容与范围

- `bin/`：原始 `process-identity`（macOS arm64）及与历史实验源哈希匹配的 C++ 源文件。
- `tmp-sources.tar.gz.part*`：139 个存留实验目录中的 6120 个脚本、配置、源码变体、构建包及所需资源。逻辑大小 586,297,794 字节，压缩后 81.6 MB，按 32 MiB 分卷。重复内容使用归档内硬链接去重。
- `deps/`：7 组依赖记录，包含原始清单、可找到的锁文件、`npm ls --all --json --offline` 输出以及 `origin.json` 来源说明。其他实验复用依赖的链接记录见 `collection-manifest.json` 的 `symlinks`。
- `collection-manifest.json`：每个归档成员的来源、原始／归档 SHA-256、权限、排除目录、依赖链接和凭据处理记录。
- `env.txt`、`runtime-checks.json`：收集时的检出版本、运行时、原生模块实测和未知项。
- `collect.py`：本次收集脚本，仅供原机器收集过程审计；路径固定，不是跨机器安装器。`restore.py` 是校验与解包入口。
- `补交清单-原始请求.md`：桌面原始清单，实际收集方式及勘误以本说明为准。

排除 `node_modules`、数据库、运行输出目录、缓存、凭据与隔离 HOME、已提交归档的出版副本，以及清单明确排除的 `willyou-m14-global-f3zh527k`。`willyou-m14-submit-scope` 是旧提交操作辅助目录，也不纳入。未纳入项目根 AGENTS/CLAUDE 规则或 `.agents/.claude` 的优化。实验资源内的应用 Skill 是实验输入，按原文件保留。

## 校验与取出

使用 Python 3.12 或以上，在本目录执行：

```bash
python3 restore.py
python3 restore.py --extract /private/tmp/m14-restored-inputs
```

第二条的目标目录必须不存在。脚本先校验每个分卷和全部成员，再解包为 `tmp/<原实验目录名>/`，复制 `bin/`、`deps/` 和 `env.txt`。会再次校验取出的每个文件，不安装依赖、不启动实验、不改现有临时目录。

取出后按各实验已提交的 README 和原锁文件准备环境。大量历史脚本写死 `/private/tmp/willyou-m14-*`、`/Users/hx/projects/SmartDD` 及共享依赖路径；本补交保留原始字节，尚未改造成可搬迁测试工具。需要在隔离机器恢复对应路径，或在实验副本中统一调整路径、核对源哈希后再复跑，不能覆盖已有实验结果。归档硬链接的重复文件若需单独改写，先复制成独立文件。

## 清单核对与勘误

| 清单项目 | 本次结果 |
| --- | --- |
| process-identity | 找到并补交原始二进制；源文件与历史源哈希匹配。原始编译提交／工具链不能完全确认，详见 env.txt。 |
| fixture-entry.mjs | 未发现物理文件。已检查的 result-route 构建脚本将它设为 import.meta.url 的虚拟定位值；不能据此判定缺少入口文件。相关 build.mjs 与实际执行脚本均保留。 |
| result-route 共用脚本 | programmatic.mjs、projection.mjs、migration.mjs、pty-unavailable.cjs 及其余存留根目录输入已归档。 |
| m10 共享依赖 | 原目录只有 node_modules 链接，实际目标是 hxWork/SmartDD；补交实际目标的 package.json、pnpm-lock.yaml 与依赖图，未伪造临时目录专属锁。 |
| browser-native 依赖 | 实际复用 owner-probe/node_modules，按来源归档清单；其余浏览器依赖目录分别保留。 |
| Node / Electron | Node 26.5.0 ABI147；Electron 42.11.14 使用 Node24.19.0 ABI146。当前共享 better-sqlite3 二进制匹配 Node，Electron 加载失败。旧 config.gypi 不能代表当前二进制。复跑须为目标运行时另建依赖环境，不能同时覆盖共享库。 |
| npm 依赖树 | 6 组退出码为 0；m10 的 pnpm 工作区用 npm ls 得到退出码 1，原样保存 problems，不记作完整安装成功。依赖重建优先依照 pnpm-lock.yaml。 |

本包补齐当前仍存留的运行输入，不承诺全部历史临时文件仍在，也不声称另一台机器已成功复跑。原研究结果和冻结证据保持原样。

本次归档校验和实际解包已执行，6,120 个文件的原始／归档／解包哈希一致；凭据值模式检查无待处理命中，未修改任何实验脚本内容。核对结果见 `verification.json`。
