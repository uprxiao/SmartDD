/** Isolated App observation of genuine SDK spawned CLI with official base tool selection. */
export function installTaskToolsFixture(modules, expected) {
  const {processModule,moduleApi,fs}=modules;
  const base=processModule.spawn;
  const tools=['TaskCreate','TaskUpdate','TaskList'];
  const switchArg='--tools='+tools.join(',');
  const toolName=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_:.\-]{0,99}$/.test(value);
  const owners=[];
  function matchFlag(argv,flag) {
    return argv.includes(flag)||argv.some(value=>typeof value==='string'&&value.startsWith(flag+'='));
  }
  function argValue(argv,flag) {
    const equal=argv.find(value=>typeof value==='string'&&value.startsWith(flag+'='));
    if(equal)return equal.slice(flag.length+1);
    const at=argv.indexOf(flag);
    return at<0?undefined:argv[at+1];
  }
  function capture(child,info) {
    let partial=Buffer.alloc(0),skipping=false;
    const look=bytes=>{
      const parts=Buffer.from(bytes).toString('utf8').split('\n');
      let carry=partial.toString('utf8');
      for(const part of parts.slice(0,-1)){
        const line=carry+part;
        carry='';
        if(skipping){skipping=false;continue;}
        if(line.length>256*1024)continue;
        let row;
        try {row=JSON.parse(line);} catch {continue;}
        if(row?.type!=='system'||row.subtype!=='init')continue;
        const values=Array.isArray(row.tools)?row.tools:[];
        info.nativeInit={toolNames:values.filter(toolName).slice(0,120),totalTools:values.length,
          version:typeof row.claude_code_version==='string'?row.claude_code_version:null,
          sessionId:typeof row.session_id==='string'?row.session_id:null,
          permissionMode:typeof row.permissionMode==='string'?row.permissionMode:null};
      }
      carry+=parts.at(-1);
      if(carry.length>256*1024){skipping=true;carry='';}
      partial=Buffer.from(carry);
    };
    child.stdout.on('data',look);
    child.once('exit',(code,signal)=>{
      info.exit={code,signal,at:Date.now()};
      child.stdout.off('data',look);
    });
  }
  function spy(command, raw, opts, ...other) {
    const argv=Array.isArray(raw)?raw:[];
    const streaming=argValue(argv,'--input-format')==='stream-json'&&argValue(argv,'--output-format')==='stream-json'
      &&(matchFlag(argv,'--session-id')||matchFlag(argv,'--resume'));
    const selected=streaming&&opts?.cwd===expected.cwd&&opts.env?.CLAUDE_CONFIG_DIR===expected.claudeConfigDir;
    if(!selected)return Reflect.apply(base,this,[command,raw,opts,...other]);
    if(fs.realpathSync(command)!==expected.claude||opts.env.HOME!==expected.home||
       !['http://127.0.0.1:3425','http://127.0.0.1:3425/'].includes(opts.env.ANTHROPIC_BASE_URL)||
       opts.env.M14_LIVE_DEEPSEEK_KEY!==undefined)
      throw Error('Refusing A76 opt-in outside the exact private Claude owner and relay');
    if(owners.length||matchFlag(argv,'--tools'))throw Error('A76 expected one native root launch without an existing --tools flag');
    const forwarded=expected.enable?[...argv,switchArg]:argv;
    const info={at:Date.now(),pid:null,mode:expected.enable?'argv-opt-in':'standard-argv',
      added:expected.enable?[switchArg]:[],cwd:opts.cwd,
      permissionMode:argValue(argv,'--permission-mode')??null,
      envFlags:{tasks:opts.env.CLAUDE_CODE_ENABLE_TASKS==='1',todo:opts.env.CLAUDE_CODE_ENABLE_TODO_TOOLS==='1'},
      nativeInit:null,exit:null};
    const process=Reflect.apply(base,this,[command,forwarded,opts,...other]);
    info.pid=process.pid;
    owners.push(info);
    capture(process,info);
    return process;
  }
  processModule.spawn=spy;
  moduleApi.syncBuiltinESMExports();
  return {
    snapshot:()=>owners,
    restore(){
      if(processModule.spawn!==spy)throw Error('A76 lost its isolated native observer');
      processModule.spawn=base;
      moduleApi.syncBuiltinESMExports();
      return true;
    }
  };
}
