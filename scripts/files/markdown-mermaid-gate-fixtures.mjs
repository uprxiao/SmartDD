const flow = 'flowchart LR\n  start[开始 中文] --> done[完成 Gate]';
const sequence = 'sequenceDiagram\n  participant User\n  participant Worker\n  User->>Worker: 真实时序 Gate\n  Worker-->>User: 完成';
const state = 'stateDiagram-v2\n  [*] --> Ready\n  Ready --> Done: Gate状态\n  Done --> [*]';
const fence = (open, body, close) => open + '\n' + body + (body ? '\n' : '') + close;
export const mermaidGateCases = [
 ['strict', fence('```mermaid', flow, '```'), true],
 ['extra-info', fence('```mermaid theme=dark', sequence, '```'), true],
 ['tilde', fence('~~~mermaid', state, '~~~'), true],
 ['titlecase', fence('```Mermaid', flow, '```'), false],
 ['uppercase', fence('```MERMAID', flow, '```'), false],
 ['similar', fence('```mermaid-js', flow, '```'), false],
 ['other', fence('```javascript', 'const gate = "中文🙂";', '```'), false],
 ['no-info', fence('```', flow, '```'), false],
 ['unclosed', fence('```mermaid', flow, ''), false],
 ['short-close', fence('```mermaid', flow, '``'), false],
 ['wrong-close', fence('```mermaid', flow, '~~~'), false],
 ['long-close', fence('```mermaid', flow, '````'), true],
 ['empty', fence('```mermaid', '', '```'), true],
 ['info-spaces', fence('```  mermaid   extra', flow, '```'), true],
 ['crlf', fence('```mermaid', flow, '```').replaceAll('\n', '\r\n'), true],
].map(([id, block, diagram]) => ({ id, name: `gate-${id}.md`, source: '# Gate 中文🙂\n\n' + block + '\n\nTail 完整🙂\n', block, diagram, empty: id === 'empty' }));
