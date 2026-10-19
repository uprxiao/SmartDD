export const diagramCases = [
 {name:'flow',source:'flowchart LR\n A[Flow Start] --> B[Flow End]',labels:['Flow Start','Flow End']},
 {name:'sequence',source:'sequenceDiagram\n participant Alice\n participant Bob\n Alice->>Bob: Sequence Message',labels:['Alice','Bob','Sequence Message']},
 {name:'class',source:'classDiagram\n class Animal {\n +String species\n +move() void\n }\n class Duck\n Animal <|-- Duck',labels:['Animal','species','move','Duck']},
 {name:'invalid',source:'flowchart LR\n A[Broken -->',error:true},
 {name:'security',source:'flowchart LR\n A[Safe Label] --> B[Safe End]\n click A "https://example.invalid/y08" "No navigation"',labels:['Safe Label','Safe End'],security:true},
 {name:'script',source:'flowchart LR\n A["<script>globalThis.__y08Executed=1</script>Script Safe"] --> B[Safe End]',labels:['Script Safe','Safe End'],security:true},
];
export const diagramDocument = source => '# Diagram Y08\r\n\r\n```mermaid\r\n'+source.replace(/\n/g,'\r\n')+'\r\n```\r\n\r\nTail 中文🙂\r\n';
