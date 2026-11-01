import {applicationToolDeclarations} from '@shared/application-capabilities';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { resolve } from 'node:path';
import { ApplicationError } from '@shared/applications';
import { CapabilityBundleSource } from '../bundle-source';
import { parseManifest } from '../manifest';
import { HostApplicationRegistry } from '../host-application-registry';
import {ConfigViewRegistry} from '../config-view-registry';
import { applicationModules, builtinApplicationModules } from '../modules';
import { ApplicationModuleRegistry, type TrustedApplicationModule } from '../modules/registry';

const third = {
  appId: 'third', contractMajors: [1], slots: ['third'], stopBeforeSwitch: false,
  presentation: { displayName: 'Third', defaultProvider: 'third', projectNote: 'Explicit selection', emptyConnectionSuffix: '', panel: null, switchTitle: 'Switch Third' },
  providers: [{
    id: 'third', appId: 'third', configApiMajor: 1, configSchema: z.object({ kind: z.literal('third'), location: z.string().min(1), batch: z.number().int().min(1).default(3) }).strict(),
    authentication: { kind: 'none', mode: 'local-readonly' }, permissions: { read: 'third.read', write: 'third.write' },
    presentation: { id: 'third', appId: 'third', title: 'Third', initial: { kind: 'third', location: '', batch: 3 }, groups: [], secret: null, icon: 'link', summaryFields: ['location'], locationField: 'location', project: { title: 'Third connection', unselectedNote: 'Not configured' } },
    async verify() { return { providerId: 'third', serviceId: 'controlled-third', accountId: 'fixture', contractMajor: 1 as const }; },
  }],
  legacyPolicy: () => ({ id: 'third.object.read', semantics: 'read', retry: 'safe-read', slots: { required: ['third'], conditional: [] } }),
  capabilities:{'third.object.read':{id:'third.object.read',method:'third.object.read',permission:'third.read',contractMajors:[1],semantics:'read',retry:'safe-read',slots:{required:['third'],conditional:[]}}},
  createData: () => ({ resolve() { throw new ApplicationError('SCOPE_DENIED', 'No fixture execution'); }, async execute() { return { fixture: true }; } }),
} as const satisfies TrustedApplicationModule;

describe('compiled application module composition', () => {
  it('keeps the two current applications and their three providers registered through one catalog', () => {
    expect(builtinApplicationModules.appIds()).toEqual(['zentao', 'mail']);
    const host = new HostApplicationRegistry(builtinApplicationModules.definitions);
    expect(host.appIds()).toEqual(['zentao', 'mail']);
    expect(host.provider('foxmail').authentication).toEqual({ kind: 'none', mode: 'local-readonly' });
    expect(host.application('zentao').stopBeforeSwitch).toBe(true);
    expect(host.application('mail').stopBeforeSwitch).toBe(false);
  });
  it('adds a new app and provider from a registration only, including schema defaults and selection validation', () => {
    const modules = new ApplicationModuleRegistry([...applicationModules, third] as const);
    const host = new HostApplicationRegistry(modules.definitions);
    expect(host.parseConfig({ kind: 'third', location: 'private' })).toEqual({ kind: 'third', location: 'private', batch: 3 });
    expect(modules.configurationSchema.parse({ kind: 'third', location: 'private' })).toEqual({ kind: 'third', location: 'private', batch: 3 });
    expect(host.parseSelection({ appId: 'third', projectId: 'project', expectedRevision: 0, enabled: true, connections: { third: null } }).appId).toBe('third');
    expect(modules.supportsModule('third', 'third', 1)).toBe(true);
    expect(modules.supportsModule('third', 'mail', 1)).toBe(false);
    expect(modules.supportsModule('third', 'third', 2)).toBe(false);
    expect(() => host.parseConfig({ kind: 'unregistered', location: 'private' })).toThrow(ApplicationError);
    expect(() => modules.configurationSchema.parse({ kind: 'third', location: 'private', command: 'arbitrary' })).toThrow();
  });
  it('returns isolated presentation data and never treats it as authority', () => {
    const view = builtinApplicationModules.providerPresentation('smtp');
    Object.assign(view.initial, { kind: 'other' });
    expect(builtinApplicationModules.providerPresentation('smtp').initial.kind).toBe('smtp');
    expect(() => builtinApplicationModules.provider('other')).toThrow(ApplicationError);
  });
  it('provides an exact-schema identity view for a newly registered provider without editing the converter framework', () => {
    const modules = new ApplicationModuleRegistry([third]), views = new ConfigViewRegistry(modules.configViews());
    const key = {providerId:'third',sourceSchemaVersion:1,targetApiMajor:1,identityContractMajor:1};
    const source = {kind:'third',location:'private',batch:3};
    expect(views.resolve(key, source, ['local-readonly']).view).toEqual(source);
    expect(() => views.resolve(key, source, ['password'])).toThrow(ApplicationError);
    expect(() => views.resolve(key, {...source, unexpected:true}, ['local-readonly'])).toThrow(ApplicationError);
    expect(() => views.resolve({...key,targetApiMajor:2}, source, ['local-readonly'])).toThrow(ApplicationError);
  });
  it('normalizes all 17 distributed v1 tools through their original business semantics', () => {
    const source = new CapabilityBundleSource(resolve('out/capability-bundles-compatibility-v1'));
    let count = 0;
    for (const entry of source.index.apps) {
      const manifest = parseManifest(source.application(entry).manifest);
      const capabilities = builtinApplicationModules.legacyCapabilities(manifest);
      expect(capabilities.map(c => c.binding.mcp!.tool)).toEqual(applicationToolDeclarations(manifest).map(t => t.name));
      expect(capabilities.every(c => c.contractMajor === 1)).toBe(true);
      count += capabilities.length;
      if (entry.appId === 'mail') {
        expect(capabilities.find(c => c.id === 'mail.send.execute')).toMatchObject({ semantics: 'external-write', approval: 'host-observed-user-authorization', protection: { kind: 'business-intent' } });
        expect(capabilities.find(c => c.id === 'mail.send.get')!.slots).toEqual({ required: [], conditional: [] });
        expect(capabilities.find(c => c.id === 'mail.resource.read')!.slots).toEqual({ required: [], conditional: ['foxmail'] });
      }
    }
    expect(count).toBe(17);
  });
  it('rejects duplicate modules, provider ownership mismatches and unknown legacy tools', () => {
    expect(() => new ApplicationModuleRegistry([third, third])).toThrow(ApplicationError);
    expect(() => new ApplicationModuleRegistry([{ ...third, providers: [{ ...third.providers[0], appId: 'other' }] }])).toThrow(ApplicationError);
    expect(() => builtinApplicationModules.module('unregistered')).toThrow(ApplicationError);
    expect(() => builtinApplicationModules.module('mail').legacyPolicy({ name: 'smartdd_mail_new_v1' } as never)).toThrow(ApplicationError);
  });
  it('rejects a provider schema that changes the requested provider identity', () => {
    const module = { ...third, providers: [{ ...third.providers[0], configSchema: z.object({kind:z.literal('third')}).transform(()=>({kind:'other'})) }] };
    const registry = new ApplicationModuleRegistry([module]);
    expect(registry.configurationSchema.safeParse({kind:'third'}).success).toBe(false);
    expect(() => new HostApplicationRegistry(registry.definitions).parseConfig({kind:'third'})).toThrow(ApplicationError);
  });
});
