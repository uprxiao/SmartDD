# Unsloth 在 M 系列 Mac 上启动与调优

调研日期：2026-10-20。对象：Apple Silicon Mac；示例模型：Qwen3.8-27B。

本文是官方资料调研与建议配置，未在本机安装、下载模型或做性能实测。截图中的 M5 Pro / 64GB 是文章作者的机器，不视为用户设备配置。

## 1. 结论与支持边界

当前官方已提供 macOS 桌面版。一般用户从 Desktop 启动最方便；需要终端、固定参数和 API 时使用 Studio / CLI。GGUF 走 llama.cpp，MLX 是另一条 Apple Silicon 路线，不能把 GGUF 文件直接当作 MLX 权重加载。[Mac 安装](https://unsloth.ai/docs/get-started/install/mac)、[推理说明](https://unsloth.ai/docs/new/studio/chat)、[Qwen3.8 指南](https://unsloth.ai/docs/models/qwen3.8)

训练支持须区分产品：当前系统要求页明确列出 Studio 的 Mac / MLX 训练支持，但 Core 部分仍写 Apple Silicon / MLX 在开发中。Qwen3.8 专项训练页也残留“MLX 即将支持”的说明。因此：Mac 推理有明确入口；具体 Qwen3.8-27B 的 Mac 训练组合需要核对安装版本和实际后端，不能直接照搬 CUDA / bitsandbytes notebook。[系统要求](https://unsloth.ai/docs/get-started/fine-tuning-for-beginners/unsloth-requirements)、[专项训练指南](https://unsloth.ai/docs/models/qwen3.8/train)

## 2. 安装与启动

### 方案 A：Desktop，优先使用

- [Mac 官方下载页](https://unsloth.ai/download/mac)
- [GitHub 最新 DMG 直链](https://github.com/unslothai/unsloth/releases/latest/download/Unsloth-Desktop-MacOS.dmg)
- [全部发布版本](https://github.com/unslothai/unsloth/releases)

打开 DMG，拖入 Applications，启动并等待初始化；在 Model hub 或模型选择器搜索仓库，选择量化并下载。也可用 Homebrew 安装：

```bash
brew install --cask unsloth
```

更新：

```bash
brew upgrade --cask unsloth
```

来源：[官方仓库](https://github.com/unslothai/unsloth)。桌面安装与命令行安装选一条即可，不必同时装两套。

### 方案 B：Studio，浏览器界面与终端控制

官方安装脚本及本机启动命令：

```bash
curl -fsSL https://unsloth.ai/install.sh | sh
unsloth studio -H 127.0.0.1 -p 8888
```

浏览器访问 <http://127.0.0.1:8888>，按界面完成首次账号／密码设置。后续仍运行启动命令；前台启动时可用 Control+C 停止。安装脚本安装的是 Studio，区别于独立 Desktop 和 Core Python 包。[Mac 安装说明](https://unsloth.ai/docs/get-started/install/mac)、[Studio 启动示例](https://unsloth.ai/docs/models/mtp)

需要手动 Python 环境时，当前要求为 Python 3.11–3.13；不要照抄 CUDA 环境命令给 Mac 安装 NVIDIA 工具链。优先原生 arm64 环境，避免混用 Rosetta 的 x86 Python 与 arm64 依赖。后者为环境排障建议。[版本要求](https://unsloth.ai/docs/get-started/fine-tuning-for-beginners/unsloth-requirements)

## 3. 下载与加载模型

先用官方基座量化建立运行基线，再比较社区去拒绝版本，便于区分后端问题和模型改造问题。

- [Unsloth Qwen3.8-27B GGUF 文件目录](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/tree/main)
- [ModelScope 同系列入口](https://www.modelscope.cn/models/unsloth/Qwen3.8-27B-GGUF)
- [社区无审查模型与具体文件直链](./Qwen3.8-27B_无审查模型与下载地址.md)

注意：Unsloth 软件可加载社区模型；使用 Unsloth 软件不等于模型已经被去审查。官方 `unsloth/Qwen3.8-27B-GGUF` 也不能仅凭发布者名称认定为无审查版。

界面流程：Model hub 搜索完整仓库名 → 选择一个量化 → 下载 → 加载 → 新建聊天验证。已有 GGUF 可在界面选择其所在目录，避免重复下载；视觉任务按该仓库要求配齐 mmproj。[已有模型导入](https://unsloth.ai/docs/new/studio/chat#using-old-existing-gguf-models)

CLI 最简启动：

```bash
unsloth run --model unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL
```

社区版本示例（未本机实测）：

```bash
unsloth run --model JonathanColetti/Qwen3.8-27B-Uncensored-GGUF:Q4_K_M
```

CLI 的 `仓库:量化` 形式来自 [API 文档](https://unsloth.ai/docs/basics/api)。若量化匹配或模板识别失败，先从界面加载具体文件，并查看日志，不随意换用另一模型模板。

## 4. 内存与模型选择

以下是保守起步建议，不是各机器已验证结果；统一内存还要留给系统、应用、缓存和视觉组件。

| Mac 统一内存 | Qwen3.8-27B 起步建议 |
| --- | --- |
| 16GB | 不作为舒适运行目标；优先更小参数模型 |
| 24GB | 可试约 4-bit、短上下文、单请求；关注内存压力 |
| 32–36GB | 从 Q4 起步，再按实际内存试 Q5／Q6 |
| 48–64GB | 从 Q4 建立速度基线，再比较 Q6／Q8 的质量收益 |
| 96GB 及以上 | 可进一步试高精度与较长上下文，仍应测延迟 |

内存足够不等于速度相同。具体芯片、内存带宽、量化内核、上下文和散热都会影响表现。不要将同为 64GB 的基础款、Pro、Max 或 Ultra 当成同等吞吐。

## 5. 推理调优：按这个顺序

### 第一步：确认确实在用 GPU

在加载日志查实际后端、Metal／MLX 设备及 offload 信息，并观察活动监视器的 GPU 历史与内存压力。只看到模型成功加载不足以证明 GPU 加速生效。先用原生 Mac 应用路径排查，别套用 Linux 的 `nvidia-smi` 或 NVIDIA Docker 教程。

### 第二步：建立简单基线

建议初始条件：单模型、单请求、纯文本、8K 上下文上限或自动上下文、关闭联网和代码工具、固定一组提示。8K 是本文测试起点，不是官方最大上下文要求。

先使用软件自动采样预设。调整回答质量时优先看对应社区模型卡；不要把所有衍生版本强制设成官方基座参数。[自动预设](https://unsloth.ai/docs/new/studio/chat)

### 第三步：优先减少不必要的思考与历史

日常改写、分类、简单问答先试关闭 Thinking 或降低 reasoning effort；复杂代码／推理再提高。对模板支持的基座，可用：

```bash
unsloth run \
  --model unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL \
  -c 8192 \
  --chat-template-kwargs '{"reasoning_effort":"medium"}'
```

此命令用于建立可控起点，未在本机执行。保留历史思考可能提高上下文消耗；缩短输出与思考能减少等待时间，不代表解码 tokens/s 一定上升。[思考控制](https://unsloth.ai/docs/models/qwen3.8)、[CLI 参数转发](https://unsloth.ai/docs/basics/api)

### 第四步：一次只比较一个量化

同一个来源按 Q4 → Q6 → Q8 对比任务成功率与速度；内存压力偏高、交换空间持续增加时先减上下文或换更小量化。不要同时更换模型作者、量化、模板和采样，否则无法归因。

### 第五步：再做 MTP 对比

MTP 属于推测解码加速，需要模型组件、配套 draft 和运行时兼容；有 MTP 文件不等于已启用。社区改造可能更改或移除 MTP，必须按同系列说明匹配，不能任意混搭。

先测关闭 MTP，再开启自动设置；有手动入口时从 draft 长度 2 起试，再试 1／3／4，最后按需要扩展到 6。记录实际接受率、延迟和内存；更长 draft 未必更快。官方 MTP 指南建议按硬件测试 1–6，而不是认为一个值通用最优。[MTP 指南](https://unsloth.ai/docs/models/mtp)

当前 MTP 通用页很多示例针对 Qwen3.6／Gemma，不应直接把它们的模型路径换成任意 Qwen3.8 社区权重就认定兼容。若界面未暴露或日志未证实该模型 MTP 生效，记录为待验证。

### 第六步：最后才调底层参数

需要时逐项测试 GPU offload、Flash Attention、batch／ubatch、KV cache 类型和线程数；先检查当前 CLI `--help` 与模型支持情况。量化 KV cache 可能省内存，也可能改变质量或性能；CPU 线程数不是越多越好。保留能恢复的默认配置，避免一次全开。[底层服务参数入口](https://github.com/ggml-org/llama.cpp/tree/master/tools/server)

## 6. 怎么验证截图中的速度

截图作者称：M5 Pro / 64GB、UD-Q4_K_XL、没有 MTP 时 15–17 tokens/s；“开 MTP 能到 20–25”在所给截图里是预期说法，缺少同条件实测记录。4090 的 42–47 tokens/s 也属于作者自述，本文未独立复现。

建议使用下面的对照账：

| 项目 | 必须记录 |
| --- | --- |
| 环境 | 芯片完整型号、内存、macOS、供电／电源模式、Unsloth 版本与后端版本 |
| 模型 | 完整仓库、文件名、revision／SHA256、模板、量化 |
| 请求 | 输入 token 数、最大输出、采样、思考状态、上下文、并发 |
| 指标 | 首 token 延迟、prompt processing 速度、生成速度、总耗时 |
| 资源 | 峰值内存、内存压力、swap 变化、持续负载后的速度 |
| MTP | 开关、draft 文件、draft 长度、接受率（若有） |
| 质量 | 同一组任务是否答对、是否重复、工具参数是否有效 |

每组先预热一次，再测至少三次取中位数。分别做短问答、长文总结、代码三类任务；固定输出上限，例如 512 tokens。区分冷加载和热运行、输入处理和输出生成；tokens/s 不等于汉字／秒。MTP 只在总延迟或有效生成速度实测改善时保留。这是本文建议的评估方法。

## 7. 接入本地 Agent

模型先在 Chat 内跑通，再打开 Settings → API 获取地址与密钥；也可由 `unsloth run` 输出连接信息。以实际启动地址、端口和 model ID 为准，不假定 UI 与 API 一定分别占固定端口。

客户端按 OpenAI 兼容接口配置，并通过 `/v1/models` 核对模型；工具调用、流式输出和 Responses 支持分别测试。接口可连通不等于所有 Agent 业务流程已兼容。[官方 API 文档](https://unsloth.ai/docs/basics/api)

## 8. 如果“调优”是指训练微调

推理调参不改权重；LoRA／QLoRA 会训练适配器，两者是不同工作。

当前文档对 Studio MLX 与 Core 的边界存在不同步，先在实际安装版确认目标模型能选中 MLX 训练后端。不要将 GGUF 推理内存、CUDA QLoRA 显存表或 NVIDIA 的 bitsandbytes 示例当作 Mac 训练保证。[支持边界](https://unsloth.ai/docs/get-started/fine-tuning-for-beginners/unsloth-requirements)

若该版本确认支持目标模型，可采用以下小规模实验起点（本文建议，不是已验证配方）：

1. 使用后端支持的原始／MLX 训练权重；另存推理 GGUF，不覆盖基线。
2. 先选纯文本、短序列 1024、batch 1、LoRA rank 8 或 16；只跑 20–50 步验证加载、反传、保存与重新加载。
3. 固定独立验证集，观察验证损失和具体任务结果；不要仅凭训练损失下降认定有效。
4. 确认稳定后再逐项提高序列、batch 或 rank；学习率和 target modules 按实际 MLX 训练实现调整。
5. 保存适配器、基座 revision、模板、训练配置；重新加载后与原版盲测。

本次没有查到足以保证 Qwen3.8-27B 在具体 M 系列机器上训练成功的完整 Mac 专项实测配方，因此没有提供“复制即能训练”的 CUDA 改写脚本。若本地版本不支持这组模型，先保留 Mac 推理路线，训练另选已验证后端。

## 9. 推荐落地顺序

Desktop 安装 → 官方 Q4 基线 → 社区 Q4 对比 → 检查 GPU 与内存 → 控制思考／历史 → 比较量化 → MTP A/B → API／Agent → 有明确数据目标后才进入训练微调。

下一步需要的设备信息：完整 M 芯片型号、统一内存、macOS 版本；用途区分创作、代码 Agent 或训练。没有这些信息，不承诺截图中的速度。

## 10. NVIDIA 替代部署方案：HyperQwen

补充日期：2026-10-20。以下依据项目文档，未安装或独立复测。

### 定位与适用场景

[HyperQwen](https://github.com/syv-ai/HyperQwen) 是针对 Qwen 模型的高性能推理部署方案，核心是固定版本 vLLM 的补丁、模型权重准备及推测解码等优化。目前主要验证对象为 Qwen3.8-27B 与 RTX 3090 24GB，可用于个人聊天、代码 Agent、长文处理及并发 API 服务。[项目说明](https://github.com/syv-ai/HyperQwen/blob/main/README.md)

它负责运行效率；模型是否为无审查版取决于加载的权重。名称带 HyperQwen 的社区权重通常表示为该方案准备，不自动代表去拒绝版本。第三方模型需要重新核对准备流程与兼容性。[第三方权重说明](https://github.com/syv-ai/HyperQwen/blob/main/docs/third-party-checkpoints.md)

### 硬件与路线选择

项目原生安装说明要求 24GB、Ampere 或更新的 NVIDIA GPU、较新驱动及约 40GB 磁盘空间。默认提供 Docker 部署；Windows 可参考其 WSL2 路线。具体显卡与多卡组合以实际复现记录为准，不能将 3090 的结果直接当作其他卡的保证。[安装要求](https://github.com/syv-ai/HyperQwen/blob/main/docs/install.md)、[Docker 说明](https://github.com/syv-ai/HyperQwen/blob/main/docs/docker.md)

| 场景 | 可选路线 |
| --- | --- |
| M 系列 Mac 本地推理 | 前文 Unsloth Desktop／Studio，使用兼容的 MLX／GGUF 后端 |
| NVIDIA 主机运行 Qwen3.8-27B | HyperQwen，核对显卡、模型及版本支持 |
| Mac 使用另一台 NVIDIA 主机 | NVIDIA 主机部署 HyperQwen，Mac 客户端通过 API 调用 |

HyperQwen 当前现成部署栈面向 NVIDIA／CUDA，不作为 Apple Silicon 原生加速方案。[安装说明](https://github.com/syv-ai/HyperQwen/blob/main/docs/install.md)

### 启动入口

以下摘录项目的 Docker Compose 快速启动路径，供部署时参考，未在本机执行：

```bash
git clone https://github.com/syv-ai/HyperQwen
cd HyperQwen
cp .env.example .env
docker compose --profile single up -d
```

个人或少量聊天使用 `single`；批量 API 请求按项目说明改选 `batch`，同一 GPU 一次运行一种模式。首次启动会拉取镜像并准备模型。实际版本、磁盘需求与配置以部署时仓库为准。[快速启动](https://github.com/syv-ai/HyperQwen#quick-start)

默认端口为 `18020`，Compose 默认绑定 `127.0.0.1`。Mac 跨机器调用时，按项目要求设置 API 密钥和监听地址，再在客户端填写实际服务地址及模型 ID；核对防火墙与网络可达性。[客户端配置](https://github.com/syv-ai/HyperQwen/blob/main/docs/clients.md)

### 如何理解性能数字

作者在 RTX 3090 24GB、250W 上报告：普通单请求约 127 tokens/s；输出复用提示内容的特定任务约 381 tokens/s；64 路并发约 1,035 tokens/s 总解码吞吐。这分别是不同任务或负载条件，不能混用，也不是本次独立实测结果。[性能表与条件](https://github.com/syv-ai/HyperQwen#the-numbers-behind-that)

实际评估沿用本文第 6 节的测速账，额外记录 HyperQwen commit、vLLM 版本、GPU 驱动、功耗限制、运行模式及推测解码配置。重点比较真实任务总耗时、首 token 延迟、质量与稳定性，而非只比较最高 tokens/s。
