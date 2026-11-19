# A60 默认模型和原生选项的实包复验准备

## 可执行范围

- `default` 优先使用。真实新建任务以 A 开始。在同一 Codex run 和 thread 通过选择器选 B，实际请求到本机合成端点为 B。真选回“默认（a60-local-default-a）”后，宿主持久选项为默认，原生 `turn/start` 明确传 A，实际端点收到 A。再次真选并使用 B 后正常退出，私有数据保留。重启同一 App、点同一任务、实际选回默认，原生 `thread/resume` 输入和回执、实际新一代 runtime 与数据库均使用同一原生 thread 和 binding，下一轮继续明确送 A。两 App 正常退出。
- `effort` 先执行同一真 A→B→默认 A。选择器真正选择已公布 `high` 并发送一次成功。故意延迟第二个 App 第一个真实 `model/list` 回执，保留原字节，正常转发其他协议。第一个真实恢复 `turn/start` 发出时释放该条回执，4.2 秒仅为测试防死锁上限。验证这一轮不含 `effort`、用户可展开真实说明；下一轮沿用同一设置高强度且原生出站明确传 `high`。保留原消息 SHA、先后关系和发原请求的 App PID。若真实目录没有公布 high、原回执未及时到达、门闩走超时或在出站前并未实际扣留原回执，则保留为夹具缺项，不能声明完成公布前后。该用法无需切换 day-to-day 配置或凭据。

Native observer 的过滤器绑定确定的 executable、cwd 和独立 CODEX_HOME，默认场景仅被动读取 stdout。选模型和设置、建任务、发送和打开提示都走真实 Electron 控件。模型选择和实际转发还检查了原生回执与本机合成模型的实际请求，模型名称是私有测试数据。试验记录按原生 turn、产品 turn、run 代次、同 binding、App PID 匹配。冷库要求两代真实 CLI／bridge 都有出生身份且处于 exited。

## 命令与资源

取得协调者分配的唯一 App／3425 槽后，用同一冻结源码、候选与 SHA。每次使用未创建的 `g04/attempt-NNN`。

```sh
cd "$c/source"
exe="$c/package/mac-arm64/WillYou.app/Contents/MacOS/WillYou"
scenario=default
/usr/bin/env -i PATH=/Users/liubu/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  TMPDIR=/private/tmp M14_ACCEPTANCE_COMMIT="$commit" M14_ACCEPTANCE_APP="$exe" \
  /Users/liubu/.local/bin/node "$c/g04/a60-model-effort-packaged.mjs" \
  "$fresh_attempt" "$asar" "$scenario"
```

读取 `result.json` 的 `releaseIds` 得各 App、CLI 和桥 PID，配合原生桥实际出生身份及两次退出 0 验证。结果连同原有源文件哈希归档。实际 OS 检查只确认本轮精确 PID、可执行路径和 3425 不再占用。

| 文件 | SHA-256 |
| --- | --- |
| `g04/a60-model-effort-packaged.mjs` | `e38bd2976fcd015a36ae17c76a2e435c9b6dbef5307c2c3ef82b46633743339f` |
| `g04/a60-closure/model-effort-observer.mjs` | `aeebea25bf65a231a3d12245c7247bcd25a57f2a6d61b66386e264a1adc29f4a` |
| `g04/a60-closure/model-effort-provider.mjs` | `ec096ba5be212ada5b8bfaea7e903f15b943a5d4f8d1c485ce8356310acd9f19` |
| `g04/a60-closure/preflight-model-effort.json` | `f73963f3f2a00f7ea0b0ffe47842ff56378b83114f7fa3e2e399ed0c511bcf50` |

离线 `node --check`、8 条静态 CDP 表达式、动态提示 locator 和选项表达式语法及 A63 197 真原生 thread／身份摘录核验均通过。目录响应按拆包和并入其他消息的顺序实测转发同一字节，模型错误、重复输入和未知标记均拒绝。尚无新的实包验收结果。 [预检](preflight-model-effort.json)
