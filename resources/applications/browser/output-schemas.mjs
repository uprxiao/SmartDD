import commands from '../../../src/shared/browser-commands.generated.json' with {type:'json'};
const byCommand=new Map(commands.map(command=>[command.command.join(' '),command.output]));
const receipt=byCommand.get('browser operation get').anyOf[1];
export function browserOutputSchema(command){
 const schema=byCommand.get(command.command.join(' '));
 if(!schema)throw Error('Missing generated browser output contract: '+command.command.join(' '));
 return command.semantics==='write'?{anyOf:[schema,{type:'object',properties:{operation:receipt,replayed:{const:true}},required:['operation','replayed'],additionalProperties:false}]}:schema;
}
