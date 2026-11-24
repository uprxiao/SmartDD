import {readFile} from 'node:fs/promises';

export const pages={
  report:{
    async open(context){
      const current=await context.evaluate('location.href');
      const desk=new URL('desk',current);
      await context.cdp('Page.navigate',{url:desk.href});
      await context.waitFor('Boolean(document.querySelector("#business-ready"))');
      await context.click('a[href="report"]');
    },
    async ready(context){
      const expires=Date.now()+5000;
      while(Date.now()<expires){
        // A click transition temporarily destroys the old execution context.
        // Retry the read only and keep the actual click single-dispatch.
        if(await context.evaluate('location.pathname.endsWith("/report")&&!!document.querySelector("select[name=month]")').catch(()=>false))return true;
        await new Promise(resolve=>setTimeout(resolve,30));
      }
      return false;
    },
  },
};

export const handlers={
  async createReport(context){
    async function denied(method,params,expected){
      try{await context.cdp(method,params);return false;}
      catch(error){return error.message===expected;}
    }
    context.equal('globalDownloadDenied',await denied('Browser.setDownloadBehavior',{behavior:'deny'},'CAPABILITY_UNAVAILABLE'));
    context.equal('outputPathDenied',await denied('WillYou.downloadArm',{expectedFilename:'../outside.csv'},'INVALID_INPUT'));
    await context.captureJson('workbench-ready',{actual:await context.evaluate('document.title')});
    const point=await context.evaluate(`(()=>{
      const option=document.querySelector('select[name="month"] option[value="11"]');
      if(!option)return null;
      const bounds=option.getBoundingClientRect();
      const x=bounds.x+bounds.width/2, y=bounds.y+bounds.height/2;
      const hit=document.elementFromPoint(x,y);
      return bounds.width>0&&bounds.height>0&&(hit===option||hit===option.closest('select'))?{x,y}:null;
    })()`);
    if(!point)throw Error('November option is not visibly actionable');
    for(const type of ['mouseMoved','mousePressed','mouseReleased']){
      await context.cdp('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...point});
    }
    const month=await context.evaluate('document.querySelector("select[name=month]").value');
    context.equal('month',month);
    await context.click('form[aria-label="月度报表"] button');
    await context.waitFor('Boolean(document.querySelector("a[href=csv]"))');
    const record=await context.evaluate('document.querySelector("p[role=status]").textContent.trim().split(" ").at(-1)');
    const attachment=await context.captureDownload(()=>context.click('a[href=csv]'),{expectedFilename:record+'.csv'});
    const csv=await readFile(attachment.path,'utf8');
    context.equal('matchesReceipt',csv==='id,month\n'+record+',11\n');
    await context.captureJson('report-receipt',{record,month,filename:attachment.filename,sha256:attachment.sha256});
    return{status:'passed'};
  },
};
