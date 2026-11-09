exports.HOST='m12-cert.test';
exports.RULE='MAP m12-cert.test 127.0.0.1';
exports.arms=[
 {id:'verify-dynamic',mechanism:'verify',revoke:[]},
 {id:'verify-close',mechanism:'verify',revoke:['close']},
 {id:'verify-reinstall',mechanism:'verify',revoke:['reinstall']},
 {id:'verify-close-reinstall',mechanism:'verify',revoke:['close','reinstall']},
 {id:'certificate-event',mechanism:'event',revoke:[],freshAfter:true},
 {id:'request-gate-event',mechanism:'gate-event',revoke:[],freshAfter:true}
];
exports.html=function({arm,tag,seed,marker}){
 const data={arm,tag,seed:!!seed,marker};const script='(()=>{const data='+JSON.stringify(data)+';if(data.seed)localStorage.setItem("p011-marker",data.marker);window.p011Document=data;})();';
 return'<!doctype html><meta charset="utf-8"><title>[I] P011 certificate fixture</title><p>Private synthetic TLS fixture</p><script>'+script+'</script>';
};
