import {describe,it,expect} from 'vitest';
import {docxRoute} from './file-docx-route.mjs';
// Literal oracle from reviewed V8 ct2, including durable host identity.
const rows=[
  {
    "id": "docx-a0-d0-r0-x0",
    "input": {
      "importKind": "docx",
      "isAttachmentPreview": false,
      "documentHostFlag": false,
      "renderFlag": false,
      "hostExcluded": false
    },
    "expectedRoute": "legacy"
  },
  {
    "id": "docx-a0-d0-r0-x1",
    "input": {
      "importKind": "docx",
      "isAttachmentPreview": false,
      "documentHostFlag": false,
      "renderFlag": false,
      "hostExcluded": true
    },
    "expectedRoute": "legacy"
  },
  {
    "id": "docx-a0-d0-r1-x0",
    "input": {
      "importKind": "docx",
      "isAttachmentPreview": false,
      "documentHostFlag": false,
      "renderFlag": true,
      "hostExcluded": false
    },
    "expectedRoute": "legacy"
  },
  {
    "id": "docx-a0-d0-r1-x1",
    "input": {
      "importKind": "docx",
      "isAttachmentPreview": false,
      "documentHostFlag": false,
      "renderFlag": true,
      "hostExcluded": true
    },
    "expectedRoute": "legacy"
  },
  {
    "id": "docx-a0-d1-r0-x0",
    "input": {
      "importKind": "docx",
      "isAttachmentPreview": false,
      "documentHostFlag": true,
      "renderFlag": false,
      "hostExcluded": false
    },
    "expectedRoute": "legacy"
  },
  {
    "id": "docx-a0-d1-r0-x1",
    "input": {
      "importKind": "docx",
      "isAttachmentPreview": false,
      "documentHostFlag": true,
      "renderFlag": false,
      "hostExcluded": true
    },
    "expectedRoute": "legacy"
  },
  {
    "id": "docx-a0-d1-r1-x0",
    "input": {
      "importKind": "docx",
      "isAttachmentPreview": false,
      "documentHostFlag": true,
      "renderFlag": true,
      "hostExcluded": false
    },
    "expectedRoute": "document"
  },
  {
    "id": "docx-a0-d1-r1-x1",
    "input": {
      "importKind": "docx",
      "isAttachmentPreview": false,
      "documentHostFlag": true,
      "renderFlag": true,
      "hostExcluded": true
    },
    "expectedRoute": "legacy"
  },
  {
    "id": "docx-a1-d0-r0-x0",
    "input": {
      "importKind": "docx",
      "isAttachmentPreview": true,
      "documentHostFlag": false,
      "renderFlag": false,
      "hostExcluded": false
    },
    "expectedRoute": "legacy"
  },
  {
    "id": "docx-a1-d0-r0-x1",
    "input": {
      "importKind": "docx",
      "isAttachmentPreview": true,
      "documentHostFlag": false,
      "renderFlag": false,
      "hostExcluded": true
    },
    "expectedRoute": "legacy"
  },
  {
    "id": "docx-a1-d0-r1-x0",
    "input": {
      "importKind": "docx",
      "isAttachmentPreview": true,
      "documentHostFlag": false,
      "renderFlag": true,
      "hostExcluded": false
    },
    "expectedRoute": "legacy"
  },
  {
    "id": "docx-a1-d0-r1-x1",
    "input": {
      "importKind": "docx",
      "isAttachmentPreview": true,
      "documentHostFlag": false,
      "renderFlag": true,
      "hostExcluded": true
    },
    "expectedRoute": "legacy"
  },
  {
    "id": "docx-a1-d1-r0-x0",
    "input": {
      "importKind": "docx",
      "isAttachmentPreview": true,
      "documentHostFlag": true,
      "renderFlag": false,
      "hostExcluded": false
    },
    "expectedRoute": "legacy"
  },
  {
    "id": "docx-a1-d1-r0-x1",
    "input": {
      "importKind": "docx",
      "isAttachmentPreview": true,
      "documentHostFlag": true,
      "renderFlag": false,
      "hostExcluded": true
    },
    "expectedRoute": "legacy"
  },
  {
    "id": "docx-a1-d1-r1-x0",
    "input": {
      "importKind": "docx",
      "isAttachmentPreview": true,
      "documentHostFlag": true,
      "renderFlag": true,
      "hostExcluded": false
    },
    "expectedRoute": "legacy"
  },
  {
    "id": "docx-a1-d1-r1-x1",
    "input": {
      "importKind": "docx",
      "isAttachmentPreview": true,
      "documentHostFlag": true,
      "renderFlag": true,
      "hostExcluded": true
    },
    "expectedRoute": "legacy"
  },
  {
    "id": "non-docx-not-legacy",
    "input": {
      "importKind": "pptx",
      "isAttachmentPreview": true,
      "documentHostFlag": false,
      "renderFlag": false,
      "hostExcluded": true
    },
    "expectedRoute": "not-legacy-docx",
    "expectedSpecificNonDocxRoute": null
  }
];
describe('DOCX source route, original host gates',()=>{
 for(const row of rows)it(row.id,()=>{const {hostExcluded,...input}=row.input as typeof row.input & {hostExcluded?:boolean};const route=docxRoute({...input,hostId:hostExcluded?'durable':'ordinary'});expect(route==='popcorn'?'document':route??'not-legacy-docx').toBe(row.expectedRoute);});
 it('absent outer flags select legacy; an attachment cannot acquire Popcorn via inner defaults',()=>{expect(docxRoute()).toBe('legacy');expect(docxRoute({isAttachmentPreview:true,documentHostFlag:true,renderFlag:true})).toBe('legacy');});
});
