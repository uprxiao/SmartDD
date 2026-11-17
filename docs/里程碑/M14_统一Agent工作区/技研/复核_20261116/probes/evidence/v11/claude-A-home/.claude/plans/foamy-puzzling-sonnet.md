# 计划：为 src/app.js 增加 sub 与 mul，并在 README 中写用法

## Context

当前仓库是一个极简 demo：

- `src/app.js` 只有一行：`export function add(a, b) { return a + b; }`
- `README.md` 只有一行：`# demo`

需求是新增减法 `sub`、乘法 `mul` 两个函数，并在 README 中补充用法说明。仓库没有 package.json、测试或构建配置，因此改动只涉及这两个文件。

## 实施方案

### 1. `src/app.js`

沿用现有风格（具名导出、单行实现），在 `add` 之后追加：

```js
export function sub(a, b) { return a - b; }
export function mul(a, b) { return a * b; }
```

不引入新依赖，不改动 `add`。

### 2. `README.md`

保留 `# demo` 标题，新增 `## 用法` 小节，用代码块展示导入与调用示例（覆盖 `add`、`sub`、`mul`）：

```md
# demo

## 用法

\`\`\`js
import { add, sub, mul } from './src/app.js';

add(2, 3); // 5
sub(5, 2); // 3
mul(4, 3); // 12
\`\`\`
```

## 验证

1. 用 Node 验证函数行为（不改文件，直接执行）：

   ```bash
   node --input-type=module -e "import('./src/app.js').then(m => console.log(m.add(2,3), m.sub(5,2), m.mul(4,3)))"
   ```

   预期输出：`5 3 12`

2. 确认 `README.md` 中的示例与实际导出名一致，且 `git diff` 仅包含两个目标文件的预期改动。
