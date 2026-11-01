import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {ApplicationError} from '@shared/applications';
import {applicationPreflightFailure,isApplicationPreflightFailure} from '../capability-preflight';

it('does not accept a copied marker or proof belonging to another operation',()=>{
 const operation=randomUUID(),failure=applicationPreflightFailure(new ApplicationError('AUTH_REQUIRED','host gate'),operation);
 expect(isApplicationPreflightFailure(failure,operation)).toBe(true);
 expect(isApplicationPreflightFailure(failure,randomUUID())).toBe(false);
 expect(isApplicationPreflightFailure({...failure as object},operation)).toBe(false);
 expect(isApplicationPreflightFailure(new ApplicationError('AUTH_REQUIRED','same code'),operation)).toBe(false);
});
it('never downgrades explicit producer uncertainty or exposes unexpected error text',()=>{
 const operation=randomUUID(),unknown=new ApplicationError('UPSTREAM_RESULT_UNKNOWN','unknown write');
 expect(applicationPreflightFailure(unknown,operation)).toBe(unknown);
 expect(isApplicationPreflightFailure(unknown,operation)).toBe(false);
 const unexpected=applicationPreflightFailure(new Error('PRIVATE_PROVIDER_DETAIL'),operation);
 expect(unexpected).toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
 expect(String(unexpected)).not.toContain('PRIVATE_PROVIDER_DETAIL');
});
