import type { z } from 'zod';
import { ApplicationModuleRegistry } from './registry';
import { zentaoModule } from './zentao';
import { mailModule } from './mail';
import {sampleKvModule} from './sample-kv';

/** Add a trusted application here; generic services consume this same registration. */
export const applicationModules = [zentaoModule, mailModule, sampleKvModule] as const;
export const builtinApplicationModules = new ApplicationModuleRegistry(applicationModules);
export const builtinHostApplications = builtinApplicationModules.definitions;
export type RegisteredApplicationConfiguration = z.infer<typeof applicationModules[number]['providers'][number]['configSchema']>;
export type RegisteredApplicationId = typeof applicationModules[number]['appId'];
export type RegisteredApplicationProvider = typeof applicationModules[number]['providers'][number]['id'];
