// Actual xterm cursor model only. The stock placeholder is not user input.
export function explainEmptyComposer(v){
 const rejectReasons=[];if(!v)return{ready:false,rejectReasons:['model-not-found']};
 if(!v.focused||!v.activeInExactTerminal||!v.activeClass?.includes('xterm-helper-textarea'))rejectReasons.push('actual-terminal-focus');
 if(!v.terminalVisible)rejectReasons.push('terminal-not-visible');
 if(!v.viewportAtBottom||!v.activeCursor?.inViewport)rejectReasons.push('bottom-cursor');
 const c=v.activeCursor??{},before=c.before??'',after=c.after??'',line=c.line??'',placeholder=after==='Ask Codex to do anything',emptyAfter=after==='';
 const emptyComposer=v.valueLength===0&&/^\s*[›❯>]\s*$/.test(before)&&(emptyAfter||placeholder)&&line.trimEnd()===(before+after).trimEnd();
 if(!emptyComposer)rejectReasons.push('composer-not-empty-ready');
 if(/(?:Resuming|Working|Connecting|Reconnecting|trust this|approval required)/i.test(v.currentScreen??''))rejectReasons.push('startup-or-prompt');
 return{ready:rejectReasons.length===0,emptyComposer,stockPlaceholderAccepted:placeholder,rejectReasons,composer:{before,after,line,valueLength:v.valueLength},focus:{focused:v.focused,terminalVisible:v.terminalVisible,activeInExactTerminal:v.activeInExactTerminal,activeClass:v.activeClass,viewportAtBottom:v.viewportAtBottom,cursorInViewport:c.inViewport}};
}
