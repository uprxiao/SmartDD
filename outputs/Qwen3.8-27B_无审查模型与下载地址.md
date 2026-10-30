# Qwen3.8-27B 社区无审查版：用途与具体下载地址

整理日期：2026-10-20。

## 说明

这些是社区修改版，并非通义官方的“无审查版”。Uncensored / Abliterated 通常表示降低拒绝回答的倾向，不代表更准确、更聪明或完全没有拒绝。Heretic 是相关改造工具／方法标识。

本文核对了 Hugging Face 仓库与文件列表，未下载大模型、未完成本地运行测试，也未逐个传输完整文件验证。大小按页面展示值记录，链接指向 main 分支，后续可能更新；需要可复现时应固定仓库 commit 并校验文件哈希。

官方基座：[Qwen/Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B)。

## 可以做什么

- 写作与角色交互：小说、剧本、反派对白、冲突场景，比较误拒绝与文风稳定性。
- 通用助手：总结、翻译、资料整理；离线隐私取决于实际本地部署方式。
- 编程：代码解释、脚本与调试；工具调用还需要推理引擎、模板和外部工具配合。
- 图片／视频理解：仅在模型保留视觉组件、配套文件齐全且运行时支持时成立；不是直接生成图片或视频。
- 研究：比较原版与修改版的拒绝、误拒绝、能力保留和鲁棒性。

以下用途来自模型卡及改造方式的归纳，不表示全部系列在每项任务上均已验证。

## 下载清单

GGUF 通常选一个主模型量化文件即可，不需要把整个仓库全部下载。看图时可能还需同仓库的 mmproj；MTP draft 是可选加速组件，需按各模型说明配置兼容运行时。

### 1. JonathanColetti

使用 Heretic 降低拒绝行为，适合作为通用聊天、写作、代码任务的对照起点。作者提供与基座的能力对比，未在本机实测。

- [模型卡](https://huggingface.co/JonathanColetti/Qwen3.8-27B-Uncensored-GGUF)
- [全部文件与下载入口](https://huggingface.co/JonathanColetti/Qwen3.8-27B-Uncensored-GGUF/tree/main)

| 文件版本 | 具体下载地址 |
| --- | --- |
| Q4_K_M，16.8 GB | [Qwen3.8-27B-Uncensored-Q4_K_M.gguf](https://huggingface.co/JonathanColetti/Qwen3.8-27B-Uncensored-GGUF/resolve/main/Qwen3.8-27B-Uncensored-Q4_K_M.gguf?download=true) |
| Q6_K，22.4 GB | [Qwen3.8-27B-Uncensored-Q6_K.gguf](https://huggingface.co/JonathanColetti/Qwen3.8-27B-Uncensored-GGUF/resolve/main/Qwen3.8-27B-Uncensored-Q6_K.gguf?download=true) |
| Q8_0，29 GB | [Qwen3.8-27B-Uncensored-Q8_0.gguf](https://huggingface.co/JonathanColetti/Qwen3.8-27B-Uncensored-GGUF/resolve/main/Qwen3.8-27B-Uncensored-Q8_0.gguf?download=true) |
| 视觉投影文件，928 MB | [mmproj-Qwen3.8-27B-Uncensored-F16.gguf](https://huggingface.co/JonathanColetti/Qwen3.8-27B-Uncensored-GGUF/resolve/main/mmproj-Qwen3.8-27B-Uncensored-F16.gguf?download=true) |

### 2. HauhauCS Aggressive

Aggressive 去拒绝路线。可重点比较创作中误拒绝、打断与语言质量。FastMTP 是加速配套文件，不能代替主模型。

- [模型卡](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF)
- [全部文件与下载入口](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/tree/main)

| 文件版本 | 具体下载地址 |
| --- | --- |
| IQ4_XS，15.7 GB | [Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-IQ4_XS.gguf](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-IQ4_XS.gguf?download=true) |
| Q4_K_P，17.9 GB | [Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q4_K_P.gguf](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q4_K_P.gguf?download=true) |
| Q6_K_P，25.9 GB | [Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q6_K_P.gguf](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q6_K_P.gguf?download=true) |
| FastMTP-32K，903 MB | [Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-FastMTP-32K.gguf](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-FastMTP-32K.gguf?download=true) |
| 视觉投影文件，931 MB | [mmproj-Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-BF16.gguf](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/mmproj-Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-BF16.gguf?download=true) |

### 3. 0bserverx Heretic

Heretic 改造后的 GGUF 系列，适合本地运行与同题比较。仓库还有 RVN 等其他分支，不应把所有文件当成完全相同的量化路线。

- [模型卡](https://huggingface.co/0bserverx/Qwen3.8-27B-Heretic-Abliterated-Uncensored-GGUF)
- [全部文件与下载入口](https://huggingface.co/0bserverx/Qwen3.8-27B-Heretic-Abliterated-Uncensored-GGUF/tree/main)

| 文件版本 | 具体下载地址 |
| --- | --- |
| Q4_K_M，16.5 GB | [Qwen3.8-27B-Heretic-Q4_K_M.gguf](https://huggingface.co/0bserverx/Qwen3.8-27B-Heretic-Abliterated-Uncensored-GGUF/resolve/main/Qwen3.8-27B-Heretic-Q4_K_M.gguf?download=true) |

### 4. OrcaRouter

保留视觉与 MTP 的社区改造系列，另提供 BF16、FP8、MLX。可用于多模态助手、工具调用与进一步微调。访问限制：当前为 gated 仓库，需要登录 Hugging Face 并接受条件；直链不绕过权限。

- [模型卡](https://huggingface.co/orcarouter/Qwen3.8-27B-Uncensored-GGUF)
- [全部文件与下载入口](https://huggingface.co/orcarouter/Qwen3.8-27B-Uncensored-GGUF/tree/main)

| 文件版本 | 具体下载地址 |
| --- | --- |
| Q4_K_M，16.8 GB | [Qwen3.8-27B-Uncensored-Q4_K_M.gguf](https://huggingface.co/orcarouter/Qwen3.8-27B-Uncensored-GGUF/resolve/main/Qwen3.8-27B-Uncensored-Q4_K_M.gguf?download=true) |
| Q6_K，22.4 GB | [Qwen3.8-27B-Uncensored-Q6_K.gguf](https://huggingface.co/orcarouter/Qwen3.8-27B-Uncensored-GGUF/resolve/main/Qwen3.8-27B-Uncensored-Q6_K.gguf?download=true) |
| 视觉投影文件，931 MB | [mmproj-Qwen3.8-27B-Uncensored-f16.gguf](https://huggingface.co/orcarouter/Qwen3.8-27B-Uncensored-GGUF/resolve/main/mmproj-Qwen3.8-27B-Uncensored-f16.gguf?download=true) |

### 5. DavidAU TURBO Fable Cold Fusion

融合后再进行 Heretic 改造，已不只是移除拒绝方向。可比较创作、角色表达和代码任务；用途是基于模型说明的判断，不是本地测评结论。

- [模型卡](https://huggingface.co/DavidAU/Qwen3.8-27B-TURBO-Fable-Cold-Fusion-735-882-Heretic-Uncensored-NEO-CODER-MAX-MTP-GGUF)
- [全部文件与下载入口](https://huggingface.co/DavidAU/Qwen3.8-27B-TURBO-Fable-Cold-Fusion-735-882-Heretic-Uncensored-NEO-CODER-MAX-MTP-GGUF/tree/main)

| 文件版本 | 具体下载地址 |
| --- | --- |
| MTP Q4_K_M，18.5 GB | [Qwen3.8-27B-TurboFCFusion-735-882-Here-Uncen-NEO-CODER-MAX-MTP-Q4_K_M.gguf](https://huggingface.co/DavidAU/Qwen3.8-27B-TURBO-Fable-Cold-Fusion-735-882-Heretic-Uncensored-NEO-CODER-MAX-MTP-GGUF/resolve/main/Qwen3.8-27B-TurboFCFusion-735-882-Here-Uncen-NEO-CODER-MAX-MTP-Q4_K_M.gguf?download=true) |
| MTP IQ4_XS，17 GB | [Qwen3.8-27B-TurboFCFusion-735-882-Here-Uncen-NEO-CODER-MAX-MTP-IQ4_XS.gguf](https://huggingface.co/DavidAU/Qwen3.8-27B-TURBO-Fable-Cold-Fusion-735-882-Heretic-Uncensored-NEO-CODER-MAX-MTP-GGUF/resolve/main/Qwen3.8-27B-TurboFCFusion-735-882-Here-Uncen-NEO-CODER-MAX-MTP-IQ4_XS.gguf?download=true) |
| LOW-MTP Q6_K，22.4 GB | [Qwen3.8-27B-TurboFCFusion-735-882-Here-Uncen-NEO-CODER-MAX-LOW-MTP-Q6_K.gguf](https://huggingface.co/DavidAU/Qwen3.8-27B-TURBO-Fable-Cold-Fusion-735-882-Heretic-Uncensored-NEO-CODER-MAX-MTP-GGUF/resolve/main/Qwen3.8-27B-TurboFCFusion-735-882-Here-Uncen-NEO-CODER-MAX-LOW-MTP-Q6_K.gguf?download=true) |

### 6. ttindall Defiance

提供配套聊天模板，可切换写作、代码、教学和角色等模式。模式来自模板构造，不等于多个独立训练的模型；应按模型卡配置模板。

- [模型卡](https://huggingface.co/ttindall/Qwen3.8-27B-Defiance-Uncensored-MTP-GGUF)
- [全部文件与下载入口](https://huggingface.co/ttindall/Qwen3.8-27B-Defiance-Uncensored-MTP-GGUF/tree/main)

| 文件版本 | 具体下载地址 |
| --- | --- |
| IQ4_XS，15.7 GB | [Qwen3.8-27B-Defiance-Uncensored-IQ4_XS.gguf](https://huggingface.co/ttindall/Qwen3.8-27B-Defiance-Uncensored-MTP-GGUF/resolve/main/Qwen3.8-27B-Defiance-Uncensored-IQ4_XS.gguf?download=true) |
| Q6_K_P，25.9 GB | [Qwen3.8-27B-Defiance-Uncensored-Q6_K_P.gguf](https://huggingface.co/ttindall/Qwen3.8-27B-Defiance-Uncensored-MTP-GGUF/resolve/main/Qwen3.8-27B-Defiance-Uncensored-Q6_K_P.gguf?download=true) |
| 配套聊天模板 | [defiance-27b.jinja](https://huggingface.co/ttindall/Qwen3.8-27B-Defiance-Uncensored-MTP-GGUF/resolve/main/defiance-27b.jinja?download=true) |
| FastMTP-32K，约 903 MB | [Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-FastMTP-32K.gguf](https://huggingface.co/ttindall/Qwen3.8-27B-Defiance-Uncensored-MTP-GGUF/resolve/main/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-FastMTP-32K.gguf?download=true) |

### 7. Huihui

同一基座的社区去拒绝系列。当前仓库同时包含多种量化与衍生路线，下列 UD-DW 版本属于其中一种，不等同于普通 Q4_K_M。

- [模型卡](https://huggingface.co/huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF)
- [全部文件与下载入口](https://huggingface.co/huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF/tree/main)

| 文件版本 | 具体下载地址 |
| --- | --- |
| UD-DW Q4_K_M，16.6 GB | [Huihui-Qwen3.8-27B-abliterated-UD-DW-Q4_K_M.gguf](https://huggingface.co/huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF/resolve/main/Huihui-Qwen3.8-27B-abliterated-UD-DW-Q4_K_M.gguf?download=true) |
| UD-DW Q6_K_L，23.9 GB | [Huihui-Qwen3.8-27B-abliterated-UD-DW-Q6_K_L.gguf](https://huggingface.co/huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF/resolve/main/Huihui-Qwen3.8-27B-abliterated-UD-DW-Q6_K_L.gguf?download=true) |
| BF16，54.7 GB | [Huihui-Qwen3.8-27B-abliterated-bf16.gguf](https://huggingface.co/huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF/resolve/main/Huihui-Qwen3.8-27B-abliterated-bf16.gguf?download=true) |

## 其他格式与完整权重

BF16 / MLX 通常需要下载仓库中的权重分片、配置、分词器和处理器等配套文件，不能只下载一个 safetensors 分片。

| 系列 | 格式 | 文件下载入口 |
| --- | --- | --- |
| JonathanColetti | BF16 完整权重 | [下载目录](https://huggingface.co/JonathanColetti/Qwen3.8-27B-Uncensored/tree/main) |
| OrcaRouter | BF16 完整权重 | [下载目录](https://huggingface.co/orcarouter/Qwen3.8-27B-Uncensored/tree/main) |
| OrcaRouter | Apple Silicon MLX | [下载目录](https://huggingface.co/orcarouter/Qwen3.8-27B-Uncensored-MLX/tree/main) |
| OrcaRouter | FP8 | [下载目录](https://huggingface.co/orcarouter/Qwen3.8-27B-Uncensored-FP8/tree/main) |
| DavidAU | 融合改造版完整权重 | [下载目录](https://huggingface.co/DavidAU/Qwen3.8-27B-TURBO-Fable-Cold-Fusion-735-882-Heretic-Uncensored-NM-DAU/tree/main) |
| Huihui | 完整权重 | [下载目录](https://huggingface.co/huihui-ai/Huihui-Qwen3.8-27B-abliterated/tree/main) |

## 如何选文件

- GGUF：用于兼容的 llama.cpp、LM Studio 等环境；具体模型支持与 MTP 支持须核对应用版本。
- MLX：面向 Apple Silicon，需匹配支持该模型的 MLX 运行时。
- Q4 / Q6 / Q8：不同量化精度和内存取舍；不同作者的同名量化不一定大小、性能完全相同。
- MTP：用于兼容运行时的推测解码加速，不代表新增知识或智能。
- 实际内存需求高于权重文件大小，还包括上下文缓存、视觉组件和软件开销。不要把文件大小当成最低运行内存。

首次比较建议保留官方基座作为对照，用相同提示、模板和采样参数测试。没有机器内存／显存信息，本文不保证某个量化能在特定设备运行。
