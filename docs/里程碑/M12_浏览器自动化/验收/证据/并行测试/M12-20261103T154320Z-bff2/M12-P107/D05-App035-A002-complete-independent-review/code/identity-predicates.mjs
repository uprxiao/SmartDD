export const identityReady=(s,text)=>!!s&&s.focused&&s.visibility==='visible'&&!s.loading&&s.alerts.length===0&&s.cmCount===1&&s.contentEditable==='true'&&s.text===text;
