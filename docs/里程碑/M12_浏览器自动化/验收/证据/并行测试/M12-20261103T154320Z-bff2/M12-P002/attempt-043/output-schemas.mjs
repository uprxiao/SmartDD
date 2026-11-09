const string={type:'string'},integer={type:'integer',minimum:0},boolean={type:'boolean'};
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const array=items=>({type:'array',items});
const nullable=schema=>({anyOf:[schema,{type:'null'}]});
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const file=object({path:string,bytes:integer,sha256:hash});
const artifact=object({file,truncatedPreview:{type:'string',maxLength:4096}});
const progress=object({confirmedChars:integer,inFlight:object({offset:integer,length:integer}),observed:object({at:string,length:integer,sha256:hash})},['confirmedChars']);
const receipt=object({requestId:string,pageId:nullable(string),command:string,state:{enum:['succeeded','failed','unknown']},effectState:{enum:['completed','not-started','unknown']},progress:nullable(progress),summary:{},errorCode:nullable(string),createdAt:integer,updatedAt:integer});
const page={pageId:string,browserPageId:string,title:string,url:string,profileId:string};
const outputs={
 'tab list':object({tabs:array({anyOf:[object({...page,kind:{const:'tab'}}),object({...page,kind:{const:'popup'},openerPageId:string})]})}),
 'tab create':object({pageId:string,url:string}),goto:object({navigated:{const:true}}),
 snapshot:{anyOf:[artifact,object({origin:string,snapshot:string,refs:array(object({ref:string,role:string,name:string,available:boolean},['ref','role','name'])),browserPageId:string,url:string,title:string},['snapshot','refs','browserPageId','url','title'])]},
 click:object({clicked:string,path:{const:'cdp'},newTab:boolean,url:string,dialogOpened:boolean},['clicked']),fill:object({filled:string}),
 type:object({typed:{const:true},progress}),inserttext:object({typed:{const:true},progress}),
 wait:object({waited:{const:true}}),
 screenshot:object({file,format:{enum:['png','jpeg']},width:integer,height:integer}),
 'operation get':{anyOf:[object({state:{const:'not-found'}}),receipt]},
 eval:{anyOf:[artifact,object({value:string,origin:string})]},
 // Exec deliberately returns the selected native subcommand's JSON. Its command policy is separate.
 exec:{},
 console:{anyOf:[artifact,object({messages:array(object({type:string,text:string,args:array({})},['type','text']))})]},
 network:{anyOf:[artifact,object({requests:array({type:'object'})})]},
};
outputs['full-screenshot']=outputs.screenshot;
export function browserOutputSchema(command){
 const name=command.command.slice(1).join(' '),schema=outputs[name];
 if(!schema)throw Error('Missing S1 output contract: '+name);
 return command.semantics==='write'?{anyOf:[schema,object({operation:receipt,replayed:{const:true}})]}:schema;
}
