export const readingFiles=['A.md','B.md'].map(path=>({path,kind:'markdown',text:Array.from({length:350},(_,i)=>`## ${path} heading ${i+1}\n\nParagraph ${i+1} 中文🙂 ${'long text '.repeat(18)}\n`).join('\n')}));
export const changedReadingSource=readingFiles[0].text.replace('A.md heading 1','A.md changed 1');
