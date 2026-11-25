// Read-only contract comparison on the frozen local source. No tool calls.
import assert from 'node:assert/strict';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/server/validators/ajv';
import commands from '../../src/shared/browser-commands.generated.json' with {type:'json'};
import {browserDefinition} from '../../resources/applications/browser/definition.mjs';
const id='browser.tab.open';
const source=commands.find(command=>command.id===id);
const capability=browserDefinition({type:'builtin'},(_app,_policy,data)=>data).capabilities.find(item=>item.id===id);
const {description,...forwardedSchema}=capability.input;
assert.deepEqual(forwardedSchema,source.input);
const validate=new AjvJsonSchemaValidator().getValidator(capability.input);
const cases={
 missing:{},
 both:{url:'https://fixture.invalid/f36',pageId:'11111111-1111-4111-8111-111111111111'},
 existingWithNew:{pageId:'11111111-1111-4111-8111-111111111111',intent:'new'},
 existingWithProfile:{pageId:'11111111-1111-4111-8111-111111111111',profileId:'synthetic-profile'},
 urlOnly:{url:'https://fixture.invalid/f36'},
 pageOnly:{pageId:'11111111-1111-4111-8111-111111111111'},
};
const actual=Object.fromEntries(Object.entries(cases).map(([name,value])=>[name,validate(value).valid]));
// Feasibility only: check AJV composition support on a private schema object.
// The production generated source and provider/tool projections are untouched.
const proposed={...structuredClone(capability.input),oneOf:[
 {required:['url'],not:{required:['pageId']}},
 {required:['pageId'],not:{anyOf:[{required:['url']},{required:['profileId']},{required:['intent'],properties:{intent:{const:'new'}}}]}}
]};
const candidateValidator=new AjvJsonSchemaValidator().getValidator(proposed);
const candidate=Object.fromEntries(Object.entries(cases).map(([name,value])=>[name,candidateValidator(value).valid]));
assert.equal(candidate.missing,false);assert.equal(candidate.both,false);
assert.equal(candidate.existingWithNew,false);assert.equal(candidate.existingWithProfile,false);
assert.equal(candidate.urlOnly,true);assert.equal(candidate.pageOnly,true);
console.log(JSON.stringify({
 scope:'local immutable schema and browserDefinition. No runtime provider/MCP/CLI tests.',
 sourceId:id,sourceInputFields:Object.keys(source.input),sourceRequired:source.input.required,
 definitionRetainsInput:true,definitionAddsDescription:typeof description==='string',capabilityName:capability.binding.mcp?.tool,
 actualAjvResults:actual,privateAjvCompositionFeasibility:candidate,
 expectedHostInvalidCases:['missing','both','existingWithNew','existingWithProfile'],
},null,2));
