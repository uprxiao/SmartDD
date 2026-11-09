// Builtin Node test reporter. Emits actual raw test events only.
export default async function* reporter(source){for await(const event of source)yield JSON.stringify(event,(_k,v)=>v instanceof Error?{name:v.name,message:v.message,stack:v.stack,...v}:v)+'\n'}
