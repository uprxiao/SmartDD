# 原用例只读快照

来源：`/Users/liubu/hx/4.uprxiao/SmartDD/docs/里程碑/M12_浏览器自动化/验收/测试用例.md`，读取时SHA `76bb7629861408e2971254a999bffff113dc917be692e401b93f29e8f3c29f6d`。统计仍由协调者维护。

| M12-T097 | R06.4、O3、O4 | U＋I | 浏览器能力清单 | 检查能力清单与 `--list`；尝试经 `exec` 调用 agent-browser 的 Cookie 导入、证书或权限类命令 | 不存在 Cookie 导入、证书放行、站点权限授予的命令；`exec` 的尝试被拒或无效 | — | 待执行 | — |

| M12-T098 | R06.5 | I | 执行 `set credentials`、`cookie set`、`storage set`、`fill` 密码框、带 `Authorization` 的 `set headers`、`cookie get` | 检查活动记录和诊断日志 | 这些参数和返回值都显示为“已脱敏”和长度，没有明文；命令本身的返回中仍有完整内容 | — | 待执行 | — |
