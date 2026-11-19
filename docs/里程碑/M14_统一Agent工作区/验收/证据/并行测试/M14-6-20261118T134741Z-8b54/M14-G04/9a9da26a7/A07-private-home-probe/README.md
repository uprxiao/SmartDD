# A07 私有 HOME 的原生发现验证

2026-11-19，原生 Codex 0.169.0 使用私有 stdio，仅执行目录、设置读取及 ephemeral thread/start。没有 turn、监听端口、外部 API 和任何订阅凭据。源码和实包未改动。三个位置都采用原 HOME → 托管私有 HOME → 原 HOME 的全新进程对照。

- [HOME 外的项目](outside.json) · [HOME 内普通目录](nested-plain.json) · [HOME 内已信任 Git 项目](nested-git.json)
- 只有私有 HOME 的进程看不到未纳管源，启动后新建的个人 Skill 经主动刷新也不出现。已纳管全局 Skill、WillYou 资源、项目 Skill 和当前运行冻结额外根四项仍可见。回到原 HOME 的进程可见原个人 Skill 和真实新增项。配置、原件及已有投影未改写，三组九个进程均退出 0。
- 首次 Git 探针未提前固定合成仓库信任，Codex `thread/start` 自动写入该私有实验的 `CODEX_HOME/config.toml`。最终 Git 对照事先固定已信任项目，保持 app-server 允许原样验证的配置，不依赖自动写信任。

这是隔离修复候选的 native 证据，D06-72 仍开放。接入前还需核对私有 HOME 对原生命令的 `~`、Git/SSH 配置、平台路径及托管与订阅兼容身份的影响。不得把此结果计为 A07 整条通过。 [SHA256SUMS](SHA256SUMS)
