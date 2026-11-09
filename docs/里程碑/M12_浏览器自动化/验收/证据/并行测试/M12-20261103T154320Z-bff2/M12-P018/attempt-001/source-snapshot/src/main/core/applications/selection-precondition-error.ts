import {ApplicationError} from '@shared/applications';

/** Only the initial selection transaction may construct this before any change/stop. */
export class SelectionPreconditionError extends ApplicationError {
 constructor(code:'REVISION_CONFLICT'|'RESOURCE_BUSY',message:string){super(code,message);this.name='SelectionPreconditionError';}
}
