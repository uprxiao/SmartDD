// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {filePanelBounds,resolveFilePanelWidth} from '@shared/file-panel-layout.mjs';
const load=async()=>{vi.resetModules();return (await import('./navigation')).navigation};
beforeEach(()=>localStorage.clear());
afterEach(()=>vi.restoreAllMocks());
describe('global outer panel preference independently of scoped tree layout',()=>{
 it('starts each new draft with a collapsed panel while retaining the task visibility preference',async()=>{
  localStorage.setItem('willyou-file-panel-open','true');
  const n=await load();
  expect(n.filePanelOpen).toBe(false);
  n.openAgentTask('t1');
  expect(n.filePanelOpen).toBe(true);
  n.newTask('p1');
  expect(n.filePanelOpen).toBe(false);
  n.toggleFilePanel();
  expect(n.filePanelOpen).toBe(true);
  n.newTask('p1');
  expect(n.filePanelOpen).toBe(false);
  n.openAgentTask('t1');
  expect(n.filePanelOpen).toBe(true);
 });
 it('migrates legacy pixels against the real measured area and reloads as a proportional width',async()=>{localStorage.setItem('willyou-file-panel-width','610');const n=await load();expect(resolveFilePanelWidth(n.filePanelWidthPreference,1108)).toBe(610);n.migrateFilePanelWidth(1108);expect(Number(localStorage.getItem('willyou-file-panel-width'))).toBeCloseTo(610/1108);const reopened=await load();expect(reopened.filePanelWidthPreference.unit).toBe('ratio');expect(resolveFilePanelWidth(reopened.filePanelWidthPreference,1408)).toBeCloseTo(610/1108*1408);reopened.migrateFilePanelWidth(1408);expect(Number(localStorage.getItem('willyou-file-panel-width'))).toBeCloseTo(610/1108)});
 it('retains the requested ratio while a narrow window temporarily clamps the panel',async()=>{localStorage.setItem('willyou-file-panel-width','0.63');const n=await load();expect(resolveFilePanelWidth(n.filePanelWidthPreference,1108)).toBeCloseTo(698.04);expect(resolveFilePanelWidth(n.filePanelWidthPreference,500)).toBe(350);expect(resolveFilePanelWidth(n.filePanelWidthPreference,1408)).toBeCloseTo(887.04);expect(localStorage.getItem('willyou-file-panel-width')).toBe('0.63');expect(filePanelBounds(500)).toEqual({minimum:350,maximum:350});expect(resolveFilePanelWidth(n.filePanelWidthPreference,0)).toBe(0)});
 it('uses a finite default for malformed preferences and ignores invalid drag measurements',async()=>{for(const raw of['NaN','Infinity','-7','0','']){localStorage.setItem('willyou-file-panel-width',raw);const n=await load();expect(resolveFilePanelWidth(n.filePanelWidthPreference,1108)).toBeCloseTo(631.56);n.setFilePanelWidth(Number.NaN,1108);n.setFilePanelWidth(610,0);n.setFilePanelWidth(610,Number.POSITIVE_INFINITY);expect(localStorage.getItem('willyou-file-panel-width')).toBe(raw);expect(resolveFilePanelWidth(n.filePanelWidthPreference,Number.POSITIVE_INFINITY)).toBe(0)}});
 it('writes only the outer preference without changing visibility, sidebar or scoped layout',async()=>{localStorage.setItem('willyou-file-panel-open','true');localStorage.setItem('smartdd-sidebar-width','310');localStorage.setItem('willyou-file-workspace:task-one','{"treeWidth":317}');const n=await load();n.openAgentTask('task-one');n.setFilePanelWidth(654,1108);expect(n.filePanelOpen).toBe(true);expect(n.sidebarWidth).toBe(310);expect(localStorage.getItem('willyou-file-workspace:task-one')).toBe('{"treeWidth":317}');expect(Number(localStorage.getItem('willyou-file-panel-width'))).toBeCloseTo(654/1108);expect(resolveFilePanelWidth(n.filePanelWidthPreference,1108)).toBeCloseTo(654)});
 it('keeps a compact default and restores the resized directory width independently from the file preview',async()=>{
  localStorage.setItem('willyou-file-panel-width','0.6');
  const navigation=await load();
  expect(resolveFilePanelWidth(navigation.directoryPanelWidthPreference,1100,true)).toBe(250);
  navigation.setFilePanelWidth(330,1100,true);
  expect(localStorage.getItem('willyou-file-panel-width')).toBe('0.6');
  const reopened=await load();
  expect(resolveFilePanelWidth(reopened.directoryPanelWidthPreference,1100,true)).toBeCloseTo(330);
  expect(resolveFilePanelWidth(reopened.directoryPanelWidthPreference,500,true)).toBe(220);
  expect(resolveFilePanelWidth(reopened.filePanelWidthPreference,1100)).toBeCloseTo(660);
 });
});
