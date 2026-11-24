// Small, frozen business test for the one approved page in the exercise.
export const pages={scope:{}};
export const handlers={
  async inside(context,test){
    await context.cdp('Page.navigate',{url:test.expected.target});
    await context.waitFor('Boolean(document.querySelector("#normal-marker"))');
    const {text,syntheticPrivate}=await context.evaluate(
      '({text:document.querySelector("#normal-marker").textContent,syntheticPrivate:document.querySelector("#normal-marker").dataset.private})'
    );
    context.equal('marker',text);
    await context.captureJson('a23-redaction-control',{
      marker:text,headers:{authorization:syntheticPrivate,'x-auth-token':syntheticPrivate},
    });
    return{status:'passed'};
  },
  async directOutside(context,test){
    await context.cdp('Page.navigate',{url:test.expected.target});
    context.equal('unexecuted',false);
    return{status:'passed'};
  },
  async redirectedOutside(context,test){
    // All operations reach the child channel in order while the first
    // operation waits on the browser's actual, server-initiated redirect.
    const navigation=context.cdp('Page.navigate',{url:test.expected.target});
    const read=context.evaluate('document.querySelector("#foreign")?.textContent');
    const click=context.click('#record');
    const artifact=context.captureJson('unexpected-followup',{present:true});
    await Promise.all([navigation,read,click,artifact]);
    context.equal('unexecuted',false);
    return{status:'passed'};
  },
  async globalUnavailable(context){
    await context.cdp('Target.getTargets');
    context.equal('unexecuted',false);
    return{status:'passed'};
  },
  async invalidOutput(context){
    await context.cdp('WillYou.downloadArm',{expectedFilename:'synthetic-output/report.csv'});
    context.equal('unexecuted',false);
    return{status:'passed'};
  },
};
