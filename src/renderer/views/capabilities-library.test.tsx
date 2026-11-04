// @vitest-environment jsdom
import {cleanup,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {CapabilitiesSection} from './capabilities';
const skill={id:'remote-password-ssh',name:'remote-password-ssh',source:'bundled',enabled:false,current:{version:'1.0.0'},versions:[],updateAvailable:false,availableVersion:null};
const api=vi.hoisted(()=>({capabilities:{projectSettings:vi.fn(),list:vi.fn(),preview:vi.fn(),setEnabled:vi.fn()}}));
vi.mock('@renderer/lib/ipc',()=>({rpc:api,events:{on:()=>()=>undefined}}));
vi.mock('@renderer/lib/hooks/useAiProfiles',()=>({useAiProfiles:()=>({data:[]})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key,i18n:{language:'zh'}})}));
afterEach(()=>cleanup());

describe('M11 R1.0 standard Skills in the shared library (2026-11-04)',()=>{
 it('shows project standard Skills as available to all sessions without a per-project switch, keeping the context MCP switch',async()=>{
  api.capabilities.projectSettings.mockResolvedValue({skills:[skill],mcpEnabled:true});
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><CapabilitiesSection projectId="p1"/></QueryClientProvider>);
  expect(await screen.findByText('capabilities.allSessions')).toBeDefined();
  expect(screen.queryByRole('switch',{name:'remote-password-ssh'})).toBeNull();expect(screen.getByRole('switch',{name:'capabilities.contextMcp'})).toBeDefined();
  expect(api.capabilities.setEnabled).not.toHaveBeenCalled();
 });
});
