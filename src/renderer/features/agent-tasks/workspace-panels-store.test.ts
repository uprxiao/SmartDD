import {afterEach,expect,it,vi} from 'vitest';
const flags=vi.hoisted(()=>({filePanelOpen:true}));
vi.mock('@renderer/core/navigation',()=>({navigation:{get filePanelOpen(){return flags.filePanelOpen;},toggleFilePanel(){flags.filePanelOpen=!flags.filePanelOpen;}}}));
vi.mock('@renderer/features/browser/open-presentation',()=>({invalidateBrowserPresentation:vi.fn()}));
import {panelsFor} from './workspace-panels-store';
afterEach(()=>vi.unstubAllGlobals());
it('M16 B10 restores only a task’s known panel selection and restores durable browser tabs without navigation',()=>{
  const values=new Map<string,string>([
    ['willyou-workspace-panels:task:reload-fixture',JSON.stringify({tabs:['files','browser','terminal'],active:'browser'})],
    ['willyou-workspace-panels:task:known-tabs',JSON.stringify({tabs:['files','invalid','files'],active:'files'})],
  ]);
  vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});
  const restored=panelsFor({kind:'task',taskId:'reload-fixture'});
  expect(restored.tabs).toEqual(['files','browser','terminal']);expect(restored.active).toBe('browser');
  restored.open('files');expect(JSON.parse(values.get('willyou-workspace-panels:task:reload-fixture')!).active).toBe('files');
  const known=panelsFor({kind:'task',taskId:'known-tabs'});expect(known.tabs).toEqual(['files']);
  known.restoreBrowser();expect(known.tabs).toEqual(['files','browser']);expect(known.active).toBe('files');
  const newTask=panelsFor({kind:'task',taskId:'fresh-fixture'});expect(newTask.tabs).toEqual(['files']);
});
