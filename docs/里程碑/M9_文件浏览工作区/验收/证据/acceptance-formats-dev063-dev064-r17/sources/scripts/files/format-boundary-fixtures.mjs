// These test dispatch, including misleading/invalid contents, not Office/TIFF decoders.
export function formatBoundaryFixtures() {
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#20aa80"/></svg>';
  const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCWQAAAAASUVORK5CYII=','base64'));
  const files={};const cases=[];
  const add=(name,bytes,caseId,kind,extra={})=>{files[name]=typeof bytes==='string'?new TextEncoder().encode(bytes):bytes;cases.push({name,caseId,kind,...extra})};
  add('svg-within-512.unknown',' '.repeat(500)+svg,'M9-T-F11','image',{mime:'image/svg+xml',width:40,height:30});
  add('svg-last-prefix-byte.unknown',' '.repeat(507)+'<svg>'+svg.slice(svg.indexOf('<rect')),'M9-T-F11','image',{mime:'image/svg+xml',decodeFailure:true});
  add('svg-after-512.unknown',' '.repeat(512)+svg,'M9-T-F11','text');
  add('svg-split-prefix.unknown',' '.repeat(509)+svg,'M9-T-F11','text');
  add('svg-xml.unknown','<?xml version="1.0"?>\n'+svg,'M9-T-F11','image',{mime:'image/svg+xml',width:40,height:30});
  add('svg-uppercase-whitespace.unknown',' \t\n'+svg.replace(/svg/g,'SVG'),'M9-T-F11','image',{mime:'image/svg+xml',decodeFailure:true});
  add('svg-comment.unknown','<!-- before SVG -->\n'+svg,'M9-T-F11','image',{mime:'image/svg+xml',width:40,height:30});
  add('plain-text.svg','Plain text, not a vector image. 中文🙂','M9-T-F11','image',{mime:'image/svg+xml',decodeFailure:true,sourceFallback:true});
  add('png-signature.svg',png,'M9-T-F11','image',{mime:'image/png',width:1,height:1});
  for(const extension of ['tif','tiff']){
    add('little-endian.'+extension,Uint8Array.from([73,73,42,0,8,0,0,0,0,0,0,0,0,0]),'M9-T-F13','unsupported',{reason:'TIFF'});
    add('text-forged-image.'+extension,'Synthetic image hint must not permit TIFF preview.','M9-T-F13','unsupported',{reason:'TIFF'});
  }
  for(const extension of ['doc','ppt','xls','key','numbers','pages','odp','ods','odt','rtf'])
    add('unsupported.'+extension,extension==='rtf'?'{\\rtf1\\ansi Synthetic unsupported RTF}':`Synthetic ${extension.toUpperCase()} unsupported dispatch fixture\r\n`,'M9-T-F25','unsupported',{reason:extension.toUpperCase()});
  return{files,cases};
}
