# A07 托管隔离补验

2026-11-19，候选 7a038ebad。准备两版完全合成的个人 MCP、hooks、Skill，每次由实际首页启动 Claude 和 Codex 托管配置，模型仅接本机回环。

[392](attempt-392/result.json)的夹具未处理无 name 的 Codex 内建工具，修正并预检后重试。[400](attempt-400/result.json)取得两版配置与四次真实运行：四条原生运行的 stateRoot 都各自托管；个人源文件哈希不变、个人 MCP 和 hook 的哨兵均未运行。Claude 两轮均未公布测试个人 Skill，Codex 两次原生上下文仍含放置在共享 Skill 目录中的个人测试 Skill 名称。A07 仍待确认此共享发现与隔离口径，以及原生订阅路径；没有改动用户配置或据此宣布通过。
