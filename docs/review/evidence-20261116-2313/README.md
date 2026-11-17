# 本次评审的定向证据

主报告：[review-20261116-2313.md](../review-20261116-2313.md)。本目录为审查证据，没有修改被审查的需求／原型／用例／研究代码，不是产品验收。

- `input-baseline.json`：最初读入的 24 个文件 SHA，以及后续核对的源文件。
- `merge-false-positive.json`／`.py`：RV01，执行原研究函数的精确代码，构造同标题／作者时间、不同内容的反例。
- `generator-replay.json`／`.py`：RV03，将原生成脚本复制到全新私有目录运行，没有回写权威账。
- `new-recordings-replay.json`／`.mjs`：RV06，V10 实际工具片段＋显式合成信封、V14 实际目标通知。
- `prototype-static-render.json`、`*-ssr.html`、`static-render.cjs`：React SSR 控件存在性检查，不是浏览器操作。
- `document-audit.json`、`.stdout`、`run-readonly-doc-audit.py`：只改变原审计的 JSON 输出位置，保留原检查；当前失败仅为历史文档链接。
- `execution-summary.json`、三份 `test-*.log`：实际模型测试／回归结果和环境边界。M14 的 25 项结果来自本轮工具实际输出，概要已记录，未补造 TAP 日志。
- `review-integrity.json`：被审查文件末次核对、报告链接检查、临时预览监听收尾。

复核时从仓库根执行，先设置 `M14_REVIEW_OUT` 为新建的仓库外证据目录，再运行本目录对应脚本。不要用本次入库证据目录当输出位置。脚本不调用真实模型，不导入会启动模型或清理原实验的探针顶层代码；合并核对只提取该探针的具名函数。静态渲染依赖此机的根依赖位置，迁移机器应先按输入清单准备相应依赖并调整定位，不将其当原型锁依赖构建。

SSR 夹具预检曾先后遇到依赖定位（需 realpath）与 JSX 模式（需 automatic）问题，修正后才取得页面结构；这些是评审夹具错误，不作为产品缺陷。本轮浏览器 host 不可用、原生 Chrome 无可操作窗口，没有做页面点击、键盘或系统 IME 测试。
