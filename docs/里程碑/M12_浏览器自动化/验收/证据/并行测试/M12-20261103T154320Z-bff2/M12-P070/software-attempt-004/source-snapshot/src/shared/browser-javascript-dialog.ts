export type BrowserJavascriptDialogKind='alert'|'confirm'|'prompt';
export interface BrowserJavascriptDialog {
  id:string;pageId:string;profileId:string;kind:BrowserJavascriptDialogKind;
  url:string;message:string;defaultValue:string;
}
