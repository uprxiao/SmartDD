# stdio 到本机 broker 隔离实验

2026-10-17。依据：[桥接候选 V2](../../MCP到主进程桥接候选V2.md)、[需求 R1.3](../../../需求.md) M10-R02／R07／R08／R09。仅合成数据和Python标准库；没有修改生产／原型、安装依赖或读取真实账号凭据。

实际链路：测试主程序模拟owner broker，启动3个独立Python子进程；子进程通过stdin／stdout处理最小MCP JSON-RPC，并通过私有AF_UNIX socket向owner发能力请求。没有TCP或外部网络。

```sh
python3 docs/里程碑/M10_三方应用接入/技研/实验/local-broker/local_broker_probe.py
```

默认沙箱首次在bind返回EPERM；常规提权经自动审查通过后复验，**15项通过、0失败，15次本机socket连接**。详见[report.json](report.json)和[evidence-manifest.json](evidence-manifest.json)。实验在`/private/tmp`创建自己的短路径0700目录、0600 socket和一次性0600 bootstrap，正常结束后全部删除。报告不保存随机token、bootstrap内容或实际临时路径。

| 检查 | 实际覆盖 |
| --- | --- |
| LB-01–03 | 私有端点权限位；真实子进程；bootstrap读取删除；初始化／列工具／调用经stdio与socket到owner，run作用域由owner决定 |
| LB-04–06 | 错token、顶层及参数内伪project、未知operation被拒绝 |
| LB-07–08 | JSON转义换行可往返，非法原始换行被拒绝；1024字节请求／2048字节响应预算生效 |
| LB-09–11 | broker写权限独立执行；旧revision拒绝；合成OS只读标记不能代替MCP外部写控制 |
| LB-12–13 | 已运行子进程在token过期／撤销后下一请求失败 |
| LB-14–15 | 3个子进程EOF退出，stdout仅JSON-RPC且不含token；owner正常关闭清空token、thread、socket及目录 |

边界：最小MCP子集不等于完整SDK一致性；Python owner不是Electron main，没有运行真实Codex／Claude。OS只读是合成标记，不是实际OS沙箱测试；写操作只是内存计数，不接任何provider。没有验证同UID强隔离、跨UID访问、Windows、在途撤销、并发／背压、token续期或崩溃恢复。

脚本仅实现每连接一请求，非生产框架；生产大结果应返回资源引用并分段读取。当前任务及外部写权限必须在owner broker重新校验，不信任请求字段或OS只读提示。
