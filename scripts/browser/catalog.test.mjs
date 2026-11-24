import test from 'node:test';import assert from 'node:assert/strict';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/server/validators/ajv';
import commands from '../../src/shared/browser-commands.generated.json' with {type:'json'};
import {browserDefinition} from '../../resources/applications/browser/definition.mjs';
const validator=new AjvJsonSchemaValidator();
const find=name=>commands.find(command=>command.command.slice(1).join(' ')===name);
const valid=(name,input)=>validator.getValidator(find(name).input)(input).valid;
test('all approved commands are discoverable once with complete input and output contracts',()=>{
 assert.equal(commands.length,91);assert.equal(new Set(commands.map(c=>c.id)).size,91);assert.equal(commands.filter(c=>c.semantics==='read').length,24);
 assert.equal(find('open-url'),undefined);
 const manifest=browserDefinition({type:'builtin'},(_app,_policy,data)=>data);assert.equal(manifest.capabilities.length,91);
 for(const capability of manifest.capabilities){assert.ok(capability.input);assert.ok(capability.output);assert.equal(capability.retry,capability.semantics==='read'?'safe-read':'never');}
});
test('opening and operating a page through MCP uses the existing browser command contracts',()=>{
 const manifest=browserDefinition({type:'builtin'},(_app,_policy,data)=>data);
 for(const id of ['tab.create','tab.open','nav.goto','nav.snapshot','interact.click','operation.get']){
  const command=commands.find(c=>c.id==='browser.'+id);
  const capability=manifest.capabilities.find(c=>c.id===command.id);
  assert.deepEqual(capability.binding.cli.command,command.command);
  assert.equal(capability.binding.mcp?.tool,`smartdd_browser_${id.replaceAll('.','_')}_v2`);
  assert.deepEqual(capability.input.properties,command.input.properties);
  assert.equal(capability.semantics,command.semantics);
  assert.equal(capability.binding.fallback,undefined);
 }
 for(const id of ['interact.eval','interact.exec','cookie.get','env.clipboard-read']){
  assert.equal(manifest.capabilities.find(c=>c.id==='browser.'+id).binding.mcp,undefined);
 }
});
test('native JSON textual values remain text-compatible while object coercion is rejected',()=>{
 for(const value of ['123',123,false])assert.equal(valid('fill',{element:'@held',value}),true);
 for(const value of [{value:'text'},['text']])assert.equal(valid('fill',{element:'@held',value}),false);
 assert.equal(valid('set headers',{headers:{Authorization:'synthetic'}}),true);
 assert.equal(valid('set headers',{headers:'{"Authorization":"synthetic"}'}),true);
 assert.equal(valid('set headers',{headers:{a:123}}),false);
 assert.equal(valid('upload',{element:'@held',files:['/private/tmp/a,b']}),true);
});
test('observation cannot take a script wait and explicit booleans are enforced',()=>{
 assert.equal(find('wait').semantics,'read');assert.equal(find('wait fn').semantics,'write');
 assert.equal(valid('wait',{fn:'window.changed=true'}),false);
 assert.equal(valid('wait fn',{fn:'window.changed=true',page:'popup',timeout:90000}),true);
 assert.equal(valid('wait fn',{fn:'true',timeout:90001}),false);
 assert.equal(valid('tab switch',{page:'one',focus:true}),true);
 assert.equal(valid('tab switch',{page:'one',focus:'true'}),false);
 assert.equal(valid('find',{locator:'role',value:'button',action:'click',name:'Save',exact:true}),true);
 assert.equal(valid('find',{locator:'role',value:'button',action:'click',exact:'true'}),false);
});
