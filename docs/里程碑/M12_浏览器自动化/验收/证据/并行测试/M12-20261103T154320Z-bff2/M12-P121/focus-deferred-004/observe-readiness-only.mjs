import assert from 'node:assert/strict';
import {waitTerminalReady} from './terminal-submit.mjs';

// This is the only entry proposed for the next preflight. It has no input call.
export async function observeTerminalReadinessOnly({app,ptyId,poll,resume,record,persist,screenshotPath,mode}){
 assert.equal(mode,'read-only-15s-no-business');assert(!record.startedAt);
 record.scope='Only original readiness predicates and actual terminal evidence; never submit followup or run optional character probe';
 try{record.accepted=await waitTerminalReady(app,ptyId,poll,resume,{record,persist,screenshotPath});record.status='original-gate-ready-no-business';}
 catch(error){record.status='original-gate-not-ready-no-business';record.error={name:error.name,message:error.message};}
 record.businessInputsDispatched=0;record.followupSubmissionCreated=false;record.optionalProbeInvoked=false;await persist();return record;
}
