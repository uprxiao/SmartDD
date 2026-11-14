# 只读模式与外部 MCP 写入边界验证

日期：2026-11-14。关联 R09／Q33；独立技术实验，不是产品验收。

## 问题与方法

验证原生只读选项是否足以证明包含外部 MCP 的整个运行只读。复用先前 HTTP MCP 驱动，在独立 HOME、配置与工作目录启动固定真实原生程序；模型响应由本机合成服务提供，不访问真实模型供应商。MCP 服务刻意声明 readOnlyHint=true、destructiveHint=false，却在自己的 handler 中写本次临时工作目录的合成文件。该工具由实验显式预批准，这不是绕过未经授权的调用。

| 原生配置 | 观察结果 |
| --- | --- |
| Claude SDK 0.3.321／native 2.1.321；dontAsk、tools=Read/Glob/Grep，单独预批准实验 MCP 工具 | 模型可见工具只有三个原生读工具及实验 MCP；MCP 一次调用写出文件，原生回合 success |
| Codex app-server 0.167.1；sandbox=read-only、approvalPolicy=never，实验 MCP default_tools_approval_mode=approve | MCP 一次调用写出文件，原生回合 completed |

两条负向边界检查通过；四次本机模型请求，两个捕获的原生进程均 exit 0，无真实业务写入。通过表示反例成立，不表示只读隔离通过。二进制在启动前校验 SHA256；版本、输入和请求记录随归档保存。

## 设计结论

原生工具限制与外部 MCP 服务执行权限是不同边界。readOnlyHint 是声明；不能据此给整个运行签发并行只读能力。外部服务可能执行目录写入、数据库／SSH、浏览器或插件动作，须由对应服务的真实授权与执行限制证明；本实验只实际覆盖合成文件写入，未运行这些业务。

T3 源码分别限制 Claude 原生工具及已知 T3 MCP 的预批准列表；不能把该实现理解成所有第三方 MCP 都被 OS 沙箱强制只读。本次未运行 T3 适配器，也未发现或证明 T3／WillYou 产品权限绕过。

WillYou 保持现行方案：没有原生工具、shell／Skill、MCP／插件业务的完整限制证据，就不开放共享目录并行只读，按可能写入排队。声明、提示词、工具名称、曾经一次没写文件，都不能替代能力证明。服务端规则／工具版本或接入配置改变后，旧能力结论不可直接沿用。

仍待验证：实际共享目录准入的串行守卫、各执行与业务路径的限制、按需读取版本变化与复核、动态接入变化、真实大项目性能。Q33 仅推进为部分证据。

## 复现与证据

解压 raw-evidence.tar.gz 后，在已记录依赖可用的本机运行 `node probe.mjs`；需允许本机监听。脚本只写新建 attempt 目录，使用合成凭据，并关闭自己启动的服务和程序。它不启动 WillYou／T3 产品。

[结果](result.json) · [源码与版本](source-review.json) · [归档校验](archive-manifest.json) · [原始证据](raw-evidence.tar.gz)。
