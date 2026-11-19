# A08 已纳管 Skill 的原生目录及输入框

[408](attempt-408/result.json)、[412](attempt-412/result.json)为驱动界面定位问题。412 已确认走真实 UI 纳管成功；原对话框遮挡了返回。

[416](attempt-416/result.json)用真实打包 App、两端真实 CLI 和本机合成响应，实际从技能页纳管来源 Skill、返回并各完成一轮暖机。Claude 和 Codex 的 $ 输入菜单均没有此 Skill，共同复现 M14 漏接已纳管 Skill 投影。A08 的 R 层真实模型执行、更新与删除控制仍单独验收。
