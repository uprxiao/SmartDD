// Current visible composer only. Never read raw PTY output or require contiguous full-prompt echo.
export function observeComposerConsumption(v,marker,{expectedText}={}){
 const raw=v?.currentScreen??'',lf=(raw.match(/\n/g)??[]).length,literal=(raw.match(/\\n/g)??[]).length,lines=lf?raw.split('\n'):literal?raw.split('\\n'):[raw],cursorRow=v?.cursorY??-1;
 let start=-1;for(let i=0;i<=Math.min(cursorRow,lines.length-1);i++)if(/^\s*[›❯>]\s*/.test(lines[i]))start=i;
 const composerRows=start>=0?lines.slice(start,cursorRow+1):[],joined=composerRows.map(x=>x.trim()).join(''),markerVisible=joined.includes(marker),rejectReasons=[];
 const expectedLength=typeof expectedText==='string'?expectedText.length:null,badge=composerRows.length===1?/^\s*[›❯>]\s*\[Pasted Content ([1-9][0-9]*) chars\]\s*$/.exec(composerRows[0]):null,pasteBadgeAccepted=!!badge&&expectedLength>0&&Number(badge[1])===expectedLength&&v?.valueLength===expectedLength;
 if(!v?.focused||!v?.activeInExactTerminal||!v.activeClass?.includes('xterm-helper-textarea'))rejectReasons.push('actual-terminal-focus');
 if(!v?.terminalVisible||!v.viewportAtBottom||!v.activeCursor?.inViewport)rejectReasons.push('visible-bottom-cursor');
 if(start<0)rejectReasons.push('current-composer-prefix-not-found');if(!markerVisible&&!pasteBadgeAccepted)rejectReasons.push('current-composer-marker-not-yet-visible');
 if(v?.activeCursor?.after==='Ask Codex to do anything')rejectReasons.push('placeholder-still-visible');
 if(/(?:Resuming|Working|Connecting|Reconnecting|trust this|approval required)/i.test(raw))rejectReasons.push('startup-or-prompt');
 return{ready:rejectReasons.length===0,rejectReasons,markerVisible,pasteBadge:{present:!!badge,characters:badge?Number(badge[1]):null,expectedCharacters:expectedLength,accepted:pasteBadgeAccepted},composerRows,cursorRow,startRow:start,LFCount:lf,literalBackslashNCount:literal,cursor:v?.activeCursor,valueLength:v?.valueLength,signature:JSON.stringify({composerRows,cursor:v?.activeCursor})};
}
