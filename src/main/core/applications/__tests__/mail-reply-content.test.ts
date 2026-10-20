import { describe,expect,it } from 'vitest';
import type { LocalMailContent } from '@shared/application-mail';
import { mailReplyContent,mailReplyHeaders } from '../mail-reply-content';
const source=(over:Partial<LocalMailContent>={}):LocalMailContent=>({id:'1',subject:'question',from:'sender@example.test',to:'self@example.test',date:'2026-10-20T04:00:00.000Z',messageId:'<original@example.test>',sourceRevision:'a'.repeat(64),hasAttachments:false,text:'body',html:null,fromAddresses:['sender@example.test'],toAddresses:['self@example.test'],cc:[],replyTo:[],references:[],inReplyTo:null,complete:true,missing:[],attachments:[],...over});
const request={reference:{connectionId:'c0010000-0000-4000-8000-000000000001',identityRevision:1,nativeId:'1',contentRevision:'a'.repeat(64)},mode:'reply-all' as const,text:'reply'};
const sender={id:'c0020000-0000-4000-8000-000000000002',address:'self@example.test'};
describe('reply derivation boundaries before durable draft creation',()=>{
 it('preserves the parent chain and uses a valid single In-Reply-To fallback when References is absent',()=>{expect(mailReplyHeaders(source({inReplyTo:'<parent@example.test>'}))).toEqual({inReplyTo:'<original@example.test>',references:['<parent@example.test>','<original@example.test>']});});
 it('refuses a missing or malformed message identity instead of inventing a reply association',()=>{for(const messageId of [null,'bad','<bad>','<a@example.test>\r\nBcc: injected@example.test'])expect(()=>mailReplyHeaders(source({messageId}))).toThrow(/Message-ID/);});
 it('does not silently drop an over-budget original reply chain',()=>{expect(()=>mailReplyHeaders(source({references:Array.from({length:100},(_,i)=>`<parent-${i}@example.test>`)}))).toThrow(/预算/);});
 it('rejects more than100 actual recipients instead of shortening reply-all',()=>{expect(()=>mailReplyContent(source({toAddresses:Array.from({length:101},(_,i)=>`person-${i}@example.test`)}),request,sender)).toThrow(/100/);});
 it('rejects invalid visible recipient addresses without accepting a partial target list',()=>{expect(()=>mailReplyContent(source({cc:['valid@example.test','invalid-address']}),request,sender)).toThrow(/地址/);});
 it('requires a real remaining target after excluding the current sender',()=>{expect(()=>mailReplyContent(source({fromAddresses:['self@example.test'],toAddresses:['SELF@example.test']}),request,sender)).toThrow(/收件人/);});
 it('preserves an existing Re prefix and rejects an oversized generated subject',()=>{expect(mailReplyContent(source({subject:'RE: original'}),request,sender).subject).toBe('RE: original');expect(()=>mailReplyContent(source({subject:'x'.repeat(2000)}),request,sender)).toThrow(/主题/);});
});
