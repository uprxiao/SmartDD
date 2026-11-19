import {createHash,randomUUID} from 'node:crypto';

const regularName=/^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/;
export const publicToolName=name=>typeof name==='string'&&regularName.test(name)?name:'[invalid-name]';
const byteHash=bytes=>createHash('sha256').update(bytes).digest('hex');

export function offeredTools(request) {
  const tools=Array.isArray(request.tools)?request.tools:[];
  const bash=tools.filter(tool=>tool?.name==='Bash');
  const properties=bash[0]?.input_schema?.properties;
  const choice=request.tool_choice;
  return {count:tools.length,names:tools.slice(0,100).map(tool=>publicToolName(tool?.name)),truncated:tools.length>100,
    bashCount:bash.length,bashSupportsCommand:Object.hasOwn(properties??{},'command'),
    bashSupportsBackground:Object.hasOwn(properties??{},'run_in_background'),
    choiceType:['auto','any','tool','none'].includes(choice?.type)?choice.type:null,
    choiceName:choice?.type==='tool'?publicToolName(choice?.name):null};
}

export function backgroundProposal(nativeBody, envelope) {
  const catalog=offeredTools(nativeBody);
  if(catalog.bashCount!==1||!catalog.bashSupportsCommand||!catalog.bashSupportsBackground)
    return {catalog,reason:'native-catalog-lacks-unique-background-bash'};
  if(catalog.choiceType==='none'||(catalog.choiceType==='tool'&&catalog.choiceName!=='Bash'))
    return {catalog,reason:'native-tool-choice-forbids-bash'};
  if(envelope!=='bash-only')return {catalog,upstreamBody:nativeBody};
  const exact=nativeBody.tools.find(tool=>tool?.name==='Bash');
  // Preserve the actual native descriptor and use auto; forced tool_choice can be incompatible with thinking.
  return {catalog,upstreamBody:{...nativeBody,tools:[exact],tool_choice:{type:'auto'}}};
}

export function inspectSse(bytes,{expectTool=false,command}={}) {
  const text=bytes.toString('utf8');
  const record={sha256:byteHash(bytes),bytes:bytes.length,toolNames:[],stopReason:null,hasMessageStop:false};
  let events;
  try{
    events=text.split(/\r?\n/).filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
  }catch{return {record,reason:'malformed-upstream-sse'};}
  if(events.some(frame=>!frame||typeof frame!=='object'))return {record,reason:'malformed-upstream-sse'};
  const blocks=events.filter(frame=>frame.type==='content_block_start'&&
    typeof frame.content_block?.type==='string'&&/(?:^|_)tool_use$/.test(frame.content_block.type));
  record.toolNames=blocks.slice(0,25).map(frame=>publicToolName(frame.content_block.name));
  record.toolCount=blocks.length;
  record.hasMessageStop=events.some(frame=>frame.type==='message_stop');
  const stop=events.findLast(frame=>frame.type==='message_delta')?.delta?.stop_reason;
  record.stopReason=['end_turn','stop_sequence','tool_use','max_tokens','refusal','pause_turn'].includes(stop)?stop:null;
  if(!record.hasMessageStop||!events.some(frame=>frame.type==='message_start')||events.some(frame=>frame.type==='error'))
    return {record,reason:'incomplete-or-error-upstream-sse'};
  if(!expectTool){
    if(blocks.length||record.stopReason==='tool_use')return {record,reason:'unexpected-tool-in-text-round'};
    return {record,tool:null};
  }
  if(!blocks.length)return {record,reason:record.stopReason==='refusal'?'real-model-refused':'real-model-did-not-propose-bash'};
  if(blocks.length!==1)return {record,reason:'multiple-tools-proposed'};
  const block=blocks[0], tool=block.content_block;
  if(tool.type!=='tool_use'||tool.name!=='Bash')return {record,reason:'real-model-proposed-different-tool-name'};
  if(typeof tool.id!=='string'||!/^[-_A-Za-z0-9]{2,180}$/.test(tool.id)||record.stopReason!=='tool_use')
    return {record,reason:'invalid-native-tool-use-identity-or-stop'};
  if(!events.some(event=>event.type==='content_block_stop'&&event.index===block.index))
    return {record,reason:'incomplete-native-tool-frame'};
  const inputEvents=events.filter(event=>event.index===block.index&&event.type==='content_block_delta'&&
    event.delta?.type==='input_json_delta');
  let args;
  try{args=inputEvents.length?JSON.parse(inputEvents.map(event=>event.delta.partial_json).join('')):tool.input;}
  catch{return {record,reason:'invalid-native-tool-input-json'};}
  if(!args||typeof args!=='object'||Array.isArray(args)||
     args.command!==command||args.run_in_background!==true||
     Object.keys(args).some(key=>!['command','description','run_in_background'].includes(key))||
     (args.description!==undefined&&(typeof args.description!=='string'||args.description.length>512)))
    return {record,reason:'different-or-unsanctioned-bash-input'};
  return {record,tool:{id:tool.id,name:tool.name}};
}

export function endDiagnostic(response,model,text='A05_LOCAL_DIAGNOSTIC_NO_TOOL_EXECUTED') {
  const event=(type,fields)=>response.write('event: '+type+'\ndata: '+JSON.stringify({type,...fields})+'\n\n');
  response.writeHead(200,{'content-type':'text/event-stream'});
  event('message_start',{message:{id:'msg_'+randomUUID().replaceAll('-',''),type:'message',role:'assistant',
    model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}});
  event('content_block_start',{index:0,content_block:{type:'text',text:''}});
  event('content_block_delta',{index:0,delta:{type:'text_delta',text}});
  event('content_block_stop',{index:0});
  event('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}});
  event('message_stop',{});
  return response.end();
}
