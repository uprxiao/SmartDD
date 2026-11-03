import test from 'node:test';import assert from 'node:assert/strict';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/server/validators/ajv';
import {browserOutputSchema} from '../../resources/applications/browser/output-schemas.mjs';
const validate=new AjvJsonSchemaValidator().getValidator(browserOutputSchema({command:['browser','tab','list'],semantics:'read'}));
const tab={pageId:'tab-id',browserPageId:'tab-id',index:0,active:true,title:'Page',url:'https://fixture.test/',profileId:'project-profile',kind:'tab'};
test('tab list accepts the actual normal and popup results through the same strict contract',()=>{assert.equal(validate({tabs:[tab,{...tab,pageId:'popup-id',browserPageId:'popup-id',kind:'popup',openerPageId:tab.pageId}]}).valid,true);});
test('a popup cannot lose its opener or invent a kind',()=>{assert.equal(validate({tabs:[{...tab,kind:'popup'}]}).valid,false);assert.equal(validate({tabs:[{...tab,kind:'unregistered'}]}).valid,false);});
test('the added popup fields do not make arbitrary output properties acceptable',()=>{assert.equal(validate({tabs:[{...tab,undeclared:'must reject'}]}).valid,false);assert.equal(validate({tabs:[{...tab,openerPageId:'invalid-on-ordinary-tab'}]}).valid,false);});
