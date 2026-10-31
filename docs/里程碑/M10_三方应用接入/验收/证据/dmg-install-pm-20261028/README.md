# PM证据

[实际范围、首轮焦点、安装边界](../../PM_T24_T70隔离DMG安装重装与原会话恢复_20261028.md)。Mac arm64 preview/adhoc，测试DMG仅本地；未发布。

- `installer.json`：DMG路径/字节/hash、blockmap及安装位置；大二进制留本机，不入库。
- `original-bundle-inventory.json`与三个`*-installation.json`：20037条完整清单/只读挂载和签名；DMG内与初装/两重装相等。
- `reinstall-data-preservation.json`：最终两次正常App之间，移除App/同DMG重装时四数据树hash/inode保护。
- `runs/`：首13组焦点让出与最终20组真实UI/CLI/MCP原JSON/日志/截图；原Skill读证据仍未验证，不以成功工具替代。
- `verification.json`：独立数据库/包/副本/源/原生进程/挂载审计，4App/10登记PID退出。
- `source-overlay.tar.gz`两外部源码，`before-sources.tar.gz`改前driver/用例账；`audit/`保留首次源码与命令。
- `documents/`文档快照；`manifest.json`逐文件hash，不含自身。

正式35/72不变，T24从未执行→部分；其余未齐保持。没有系统Applications/Gatekeeper/公证/其他OS/Claude/默认目录品牌迁移/跨版本升级通过结论。
