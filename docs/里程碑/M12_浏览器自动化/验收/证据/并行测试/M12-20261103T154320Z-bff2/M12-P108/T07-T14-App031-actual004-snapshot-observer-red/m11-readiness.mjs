// M11 original lifecycle contract. A duplicate settings event before input is diagnostic, not authority.
import {explainResumeReadiness} from './resume-readiness.mjs';
export function explainM11Readiness(v,expected,rows,proof,at=Date.now()){
 const observed=explainResumeReadiness(v,expected,rows,at),{freshExactRunSettings,...predicates}=observed.predicates;
 predicates.actualPreSendPolicy=!!proof?.verified&&proof.runId===expected.runId&&proof.taskId===expected.taskId&&proof.projectId===expected.projectId&&proof.ptyId===expected.ptyId&&proof.nativeId===expected.nativeId&&proof.cwd===expected.cwd;
 const rejectReasons=Object.entries(predicates).filter(([,ok])=>!ok).map(([k])=>k);
 return{...observed,predicates,rejectReasons,settingsEventDiagnostic:{freshExactRunSettings,requiredBeforeM11Send:false,source:'Borrowed T095/T125 observation, not original T07/T14 business prerequisite'},ready:rejectReasons.length?null:{runId:expected.runId,ptyId:expected.ptyId,nativeSessionId:expected.nativeId,cwd:expected.cwd,runStartedAt:expected.startedAt,planHash:proof.planHash,profileHash:proof.profileHash,tomlHash:proof.tomlHash,source:'Actual canonical run/profile/TOML proof + exact current bottom composer; new-turn Native/Host proof remains mandatory'}};
}
