import type {ProjectService} from '../projects/project-service';
import type {ApplicationSelectionService} from './selection-service';

/** Register after the trusted browser host is ready; do not enumerate old projects. */
export function installBrowserProjectDefaults(projects:ProjectService,selections:ApplicationSelectionService,changed?:()=>void):()=>void{
  return projects.onCreated(projectId=>{
    selections.initializeProjectDefault(projectId,'browser');
    changed?.();
  });
}
