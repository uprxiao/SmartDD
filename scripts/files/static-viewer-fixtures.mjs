import {png} from './notebook-fixtures.mjs';
export function staticViewerFixtures(trap='http://127.0.0.1:9/forbidden'){
 const complex='---\r\ntitle: METADATA_中文🙂\r\n---\r\n\r\n# GFM_HEADING\r\n\r\n| ColA | ColB |\r\n| --- | --- |\r\n| TABLE_中文 | 🙂 |\r\n\r\n- [ ] TASK_unchecked\r\n- [x] TASK_checked\r\n\r\nTAIL_metadata\r\n';
 const math='# Code and math\r\n\r\nInline math $a^2+b^2=c^2$\r\n\r\n```javascript\r\nconst value = "CODE_中文🙂";\r\n```\r\n\r\n$$\r\n\\frac{'+Array.from({length:60},(_,i)=>`x_{${i}}`).join('+')+'}{\\sqrt{1+y^2}}\r\n$$\r\n\r\nTAIL_math\r\n';
 const diagram='# Mermaid\n\n```mermaid\ngraph TD\n A[START_中文] --> B[END_完成]\n```\n\nTAIL_diagram\n';
 const links='# Linked images\n\n![same](<同目录 中文 space.png>)\n\n![parent](<../assets/父目录 中文.png>)\n\n![outside](../../outside.png)\n\n[Internal target](<目标 中文.md#section>)\n\n[Same document anchor](#section)\n\n[External local test]('+trap+'/external)\n\n## Section\n\nTARGET_ANCHOR\n\nTAIL_links\n';
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="40" height="30" onload="window.__svgAttack=1"><script>window.__svgAttack=2;fetch('${trap}/script')</script><foreignObject width="10" height="10"><iframe xmlns="http://www.w3.org/1999/xhtml" src="${trap}/frame"></iframe></foreignObject><image xlink:href="${trap}/image" width="10" height="10"/><rect x="12" y="10" width="20" height="15" fill="green"/></svg>`;
 return{files:{'metadata-gfm.md':complex,'math-code.md':math,'diagram.md':diagram,'docs/links.md':links,'docs/目标 中文.md':'# Section\n\nINTERNAL_TARGET_中文🙂\n','docs/同目录 中文 space.png':Buffer.from(png,'base64'),'assets/父目录 中文.png':Buffer.from(png,'base64'),'attack.svg':svg},complex,math,diagram,links,svg};
}
