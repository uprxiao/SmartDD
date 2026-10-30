export const modeSwitchSource = '# Mode switch 中文🙂\n\n'+Array.from({length:120},(_,i)=>'## Section '+(i+1)+'\n\n'+'Paragraph '+(i+1)+' 中文🙂 '+('source-wide-token '.repeat(32))+'\n\n').join('');
export const modeSwitchNames=['long.md','other.md',...['light','dark'].flatMap(theme=>['dirty','saving','failure','away','back'].map(kind=>theme+'-'+kind+'.md'))];
