function installP062UiObserver(){
  if(window.__P062UiObserver)throw Error('Fresh UI observer required');
  const records=[],requests=[],installedAtMs=Date.now(),selector='[data-browser-panel="access-request"]';
  const snapshot=()=>({atMs:Date.now(),dialogs:[...document.querySelectorAll(selector)].map(e=>({label:e.getAttribute('aria-label'),text:e.textContent,visible:!!e.getBoundingClientRect().width&&getComputedStyle(e).visibility!=='hidden'})),observedRequests:[...requests],mutations:[...records],installedAtMs});
  function recordNode(node,kind){if(node.nodeType!==Node.ELEMENT_NODE)return;const matches=[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)];for(const e of matches)records.push({atMs:Date.now(),kind,label:e.getAttribute('aria-label'),text:e.textContent});}
  for(const e of document.querySelectorAll(selector))recordNode(e,'initial');
  const observer=new MutationObserver(changes=>{for(const change of changes){for(const node of change.addedNodes)recordNode(node,'added');for(const node of change.removedNodes)recordNode(node,'removed');}});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  const off=window.electronAPI.eventOn('browser:access-changed',value=>requests.push({atMs:Date.now(),channel:'browser:access-changed',value}));
  window.__P062UiObserver={snapshot,stop(){observer.disconnect();off();return snapshot();}};
  return snapshot();
}
