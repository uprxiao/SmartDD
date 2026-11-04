# P063006：框架身份假设被实测否定

本轮只回答新的身份关联问题：主frame连续七次、srcdoc和真正跨站iframe各一次，实际原生frameToken与实际CDP对话框frameId九对全部不同；各自同frame内稳定，不能混用。原生callback／CDP闭合事件正常，无运行错误。原始先存，独立判定为“等同假设被否定”，不是产品红或原用例通过。

[Electron官方说明](https://www.electronjs.org/docs/latest/api/web-frame-main#frameframetoken-readonly)定义了Native frameToken在renderer进程内的身份；这里没有把它推定为CDP身份。生产适配必须分别保留各自身份并核准事件关联，不能拿该token错误清理另一个框架的提示。5PID／1HTTP均清，正常退出0无fallback；没有生产改动。
