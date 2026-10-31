import {basename,join} from 'node:path';
import {checkDetailControls} from './detail-controls-ui.mjs';
const controls=process.env.WILLYOU_DETAIL_CONTROLS_UI==='1';
// T22 detail/P03 observations. All tested actions stay in the original UI driver.
import {installCatalogVisualProbe} from './catalog-visual-probe.mjs';
export async function installDetailVisualProbe(options){
 const base=await installCatalogVisualProbe({...options,resultKey:'detailVisualProbe',outputName:'detail-visual-probe.json',hoverSelector:'.m10-back',focusSelector:null,
 selectorsExtra:{back:'.m10-back',appHeading:'.m10-app-heading',appMark:'.m10-app-heading>.m10-appmark',appTitle:'.m10-app-heading h1',appTagline:'.m10-app-heading p',appAdd:'.m10-app-heading button.primary',appMore:'.m10-app-heading button[aria-label="应用更多操作"]',detailGrid:'.m10-detail-grid',primary:'.m10-detail-primary',package:'.m10-package-section',packageHeading:'.m10-package-heading',packageHeadingTitle:'.m10-package-heading h2',packageDescription:'.m10-package-description',packageSkills:'.m10-bundled-skills',packageDisclosure:'.m10-package-disclosure',packageContents:'.m10-package-contents',packageDisclosureIcon:'.m10-package-disclosure svg',meta:'.m10-detail-meta',connectionHeading:'.m10-section-heading',connection:'.m10-connection',connectionIcon:'.m10-connection-icon',connectionCopy:'.m10-connection-copy',connectionName:'.m10-connection-copy strong',connectionConfig:'.m10-connection-copy small',connectionState:'.m10-connection .m10-state',unconnected:'.m10-unconnected',unconnectedText:'.m10-unconnected p',unconnectedAction:'.m10-unconnected button',sender:'.m10-sender-row',form:'.m10-dialog form',formIntro:'.m10-form-intro',formTest:'.m10-test-status',formError:'.m10-dialog [role=alert]',formSave:'.m10-dialog button[type=submit],.m10-dialog footer button.primary'},
 groups:{sectionHeadings:'.m10-section-heading',metaHeadings:'.m10-detail-meta h3',metaText:'.m10-detail-meta p',metaCapabilities:'.m10-detail-meta>div',skillRows:'.m10-bundled-skills article',packageToolRows:'.m10-package-contents>div',connections:'.m10-connection',formFields:'.m10-dialog .m10-field',formControls:'.m10-dialog input,.m10-dialog select',formButtons:'.m10-dialog footer button',headingButtons:'.m10-app-heading button',menuItems:'.m10-menu button'}});
 if(!controls)return base;
 const capture=options.app.screenshot.bind(options.app);
 options.app.screenshot=async file=>{
  await capture(file);const match=basename(file).match(/^(light|dark)-(zentao|mail)-(unadded|unconfigured|ready)\.png$/);
  if(match)await checkDetailControls({...options,userData:join(options.root,'userdata'),theme:match[1],applicationId:match[2],state:match[3]});
 };
 return base;
}
