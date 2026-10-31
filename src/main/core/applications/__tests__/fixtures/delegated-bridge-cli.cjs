// A private synthetic native CLI. The actual immutable bridge is its own child,
// with MCP stdin/stdout inherited unchanged. No model or external service.
const {spawn}=require('node:child_process');
const child=spawn(process.execPath,[process.argv[2],'--bootstrap',process.argv[3]],{stdio:'inherit',env:process.env});
child.once('error',()=>{process.stderr.write('private CLI fork failed\n');process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code??1;});
