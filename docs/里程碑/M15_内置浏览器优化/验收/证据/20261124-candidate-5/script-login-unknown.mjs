export const pages={desk:{ready:'!!document.querySelector("#business-ready")'}};
export const handlers={
  async pauseOnOriginalPage(context){
    const marker=await context.evaluate('document.querySelector("#business-ready").textContent');
    await context.captureJson('before-login',{marker});
    await context.recordCheckpoint('read-after-login');
    await context.click('#report-write');
    await context.waitFor('document.querySelector("#script-held")?.textContent==="结果待核对"');
    await context.waitForLogin();
    throw new Error('An awaiting-login execution must stop dispatching');
  },
};
export const resumeHandlers={
  async resumeOriginalPage(context){
    const marker=await context.evaluate('document.querySelector("#business-ready").textContent');
    context.equal('deskMarker',marker);
    await context.captureJson('after-login',{marker});
    return{status:'passed'};
  },
};
