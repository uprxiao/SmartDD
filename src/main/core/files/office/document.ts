import { createHash,randomUUID } from 'node:crypto';
import { FileError } from '@shared/files';
import { OFFICE_LIMITS, type OfficeCellEdit, type OfficeEditState, type OfficeFormulaValidation, type OfficeSheetAction,type OfficeRangeAction } from '@shared/file-office';
import { OfficePackage } from './package';
import { verifyOfficeCandidate } from './fidelity';
import { OfficeWorkbook } from './workbook';
import { editOfficeCell } from './cell-edit';
import { prepareOfficeCalculation, transplantOfficeCalculation } from './calculation';
import { editOfficeSheet } from './sheet-edit';
import { editOfficeRange } from './range-edit';
import { prepareOfficeFit } from './fit-edit';
import type {OfficeMeasureResult} from '@shared/office-measure';
import type {OfficeWorkbookInfo} from '@shared/file-office';
import type {PptxImageReceipt} from './pptx-image';
import {refreshWorkbookChartCaches} from './workbook-chart-cache';

interface Entry { identity: number; packageData: OfficePackage }
/** A document lives in its Worker, independently of any mounted preview. History
 * shares immutable, unedited parts. Calculation caches do not create user edits. */
export class OfficeDocument {
  workbook: OfficeWorkbook;
  private fontMetric:NonNullable<OfficeWorkbookInfo['fontMetric']>={digitWidth:7,measured:false};
  private history: Entry[];
  private cursor = 0;
  private sequence = 0;
  private version = 0;
  private savedIdentity = 0;
  private savedFormulas: Map<string,string>;
  private stagedRange?:{token:string;version:number;packageData:OfficePackage};
  private prepared?: { packageData: OfficePackage; hash: string; version: number };
  private snapshot?: { bytes: Buffer; hash: string; version: number; identity: number };
  constructor(file: OfficePackage) {
    this.workbook = new OfficeWorkbook(file,this.fontMetric); this.history = [{ identity: 0, packageData: file }];
    this.savedFormulas=this.formulaFingerprints();
  }
  state(): OfficeEditState { return { version: this.version, dirty: this.history[this.cursor].identity !== this.savedIdentity, canUndo: this.cursor > 0, canRedo: this.cursor < this.history.length - 1, workbook: this.workbook.info }; }
  private assertVersion(version: number) { if (version !== this.version) throw new FileError('CHANGED', '工作簿编辑版本已改变，请重试当前操作'); }
  private formulaFingerprint(value: ReturnType<OfficeWorkbook['formulas']> extends Generator<infer T> ? T : never):string {
    return createHash('sha256').update(JSON.stringify([value.sheetName,value.formula])).digest('hex');
  }
  private formulaFingerprints():Map<string,string> {
    return new Map([...this.workbook.formulas()].map(value=>[`${value.sheetId}/${value.address}`,this.formulaFingerprint(value)]));
  }
  validationFormulas(version:number):OfficeFormulaValidation[] {
    this.assertVersion(version);
    const result:OfficeFormulaValidation[]=[]; let bytes=0;
    for (const value of this.workbook.formulas()) {
      if (this.savedFormulas.get(`${value.sheetId}/${value.address}`) === this.formulaFingerprint(value)) continue;
      const formula=value.formula.text;
      if (!formula.trim() || formula.length>8192) throw new FileError('INVALID_INPUT','修改后的公式为空或超过 8192 个字符；草稿仍保留');
      bytes+=Buffer.byteLength(formula,'utf8')*4/3+64;
      if (result.length>=OFFICE_LIMITS.validationFormulas || bytes>OFFICE_LIMITS.validationBytes) throw new FileError('TOO_LARGE','本次公式校验超过处理预算；草稿仍保留');
      result.push({sheetIndex:value.sheetIndex,row:value.row,formula});
    }
    return result;
  }
  edit(version: number, input: OfficeCellEdit): OfficeEditState {
    this.assertVersion(version);
    const result = editOfficeCell(this.workbook.packageData, input);
    if (result.packageData === this.workbook.packageData) return this.state();
    return this.push(result.packageData);
  }
  sheetAction(version:number,action:OfficeSheetAction) {
    this.assertVersion(version);
    const result=editOfficeSheet(this.workbook.packageData,action);
    return {state:result.packageData === this.workbook.packageData ? this.state() : this.push(result.packageData),sheetId:result.sheetId};
  }
  setFontMetric(metric:NonNullable<OfficeWorkbookInfo['fontMetric']>) {
    this.fontMetric=metric;this.workbook=new OfficeWorkbook(this.workbook.packageData,metric);return this.workbook.info;
  }
  prepareFit(version:number,action:OfficeRangeAction) {
    this.assertVersion(version);if(action.type!=='fit')throw new FileError('INVALID_INPUT','尺寸测量动作无效');return prepareOfficeFit(this.workbook,action).input;
  }
  async prepareRange(version:number,action:OfficeRangeAction,measured?:OfficeMeasureResult,imageReceipt?:PptxImageReceipt) {
    this.assertVersion(version);this.stagedRange=undefined;
    const file=refreshWorkbookChartCaches(this.workbook,editOfficeRange(this.workbook.packageData,action,measured,imageReceipt)),model=new OfficeWorkbook(file,this.fontMetric),before=this.formulaFingerprints(),formulas:OfficeFormulaValidation[]=[];let bytes=0;
    for(const value of model.formulas()) {
      if(before.get(`${value.sheetId}/${value.address}`) === this.formulaFingerprint(value))continue;
      bytes+=Buffer.byteLength(value.formula.text,'utf8')*4/3+64;
      if(formulas.length>=OFFICE_LIMITS.validationFormulas || bytes>OFFICE_LIMITS.validationBytes)throw new FileError('TOO_LARGE','选区公式超过校验预算，修改尚未应用');
      formulas.push({sheetIndex:value.sheetIndex,row:value.row,formula:value.formula.text});
    }
    const token=randomUUID(),candidate=formulas.length ? await file.bytes() : undefined;
    this.stagedRange={token,version,packageData:file};return {token,formulas,...(candidate ? {bytes:candidate} : {})};
  }
  commitRange(version:number,token:string) {
    this.assertVersion(version);const staged=this.stagedRange;
    if(!staged || staged.token !== token || staged.version !== version)throw new FileError('CHANGED','选区候选已过期，修改尚未应用');
    this.stagedRange=undefined;return staged.packageData === this.workbook.packageData ? this.state() : this.push(staged.packageData);
  }
  cancelRange(token:string) {if(this.stagedRange?.token === token)this.stagedRange=undefined;}
  restore(version: number, file: OfficePackage): OfficeEditState {
    this.assertVersion(version);
    const model = new OfficeWorkbook(file,this.fontMetric);
    if (model.info.kind !== this.workbook.info.kind || model.info.kind !== 'xlsx') throw new FileError('INVALID_INPUT', '草稿与工作簿类型不一致');
    return this.push(file);
  }
  private push(file: OfficePackage): OfficeEditState {
    file=refreshWorkbookChartCaches(this.workbook,file);
    const model = new OfficeWorkbook(file,this.fontMetric);
    this.history.splice(this.cursor + 1); this.history.push({ identity: ++this.sequence, packageData: file }); this.cursor++;
    this.workbook = model; this.changed(); this.trim(); return this.state();
  }
  undo(version: number, direction: 'undo' | 'redo'): OfficeEditState {
    this.assertVersion(version);
    const next = this.cursor + (direction === 'undo' ? -1 : 1);
    if (next < 0 || next >= this.history.length) return this.state();
    const model = new OfficeWorkbook(this.history[next].packageData,this.fontMetric);
    this.cursor = next; this.workbook = model; this.changed(); return this.state();
  }
  private changed() { this.version++; this.prepared = undefined; this.snapshot = undefined;this.stagedRange=undefined; }
  private trim() {
    const currentBytes = OfficePackage.retainedBytes([this.workbook.packageData]);
    while (this.history.length > 1 && (this.history.length > OFFICE_LIMITS.historyEntries || OfficePackage.retainedBytes(this.history.map((entry) => entry.packageData)) - currentBytes > OFFICE_LIMITS.historyBytes)) {
      if (this.cursor > 0) { this.history.shift(); this.cursor--; } else this.history.pop();
    }
  }
  async prepareCalculation() {
    const input = prepareOfficeCalculation(this.workbook.packageData);
    if (!input.formulas) { this.prepared = undefined; return null; }
    const bytes = await input.packageData.bytes(), hash = createHash('sha256').update(bytes).digest('hex');
    this.prepared = { packageData: input.packageData, hash, version: this.version }; return { bytes, hash, formulas: input.formulas };
  }
  async applyCalculation(bytes: Uint8Array, inputHash: string): Promise<OfficeEditState> {
    if (!this.prepared || this.prepared.hash !== inputHash || this.prepared.version !== this.version) throw new FileError('CHANGED', 'Office 计算回执已过期');
    const expected = this.prepared; this.prepared = undefined;
    if (bytes.byteLength > OFFICE_LIMITS.outputBytes) throw new FileError('TOO_LARGE', 'Office 计算结果超过预算');
    const calculated = await OfficePackage.read(bytes), result = transplantOfficeCalculation(this.workbook.packageData, calculated, expected.packageData),packageData=refreshWorkbookChartCaches(this.workbook,result.packageData),model = new OfficeWorkbook(packageData,this.fontMetric);
    this.workbook = model; this.history[this.cursor] = { ...this.history[this.cursor], packageData }; this.snapshot = undefined; this.trim(); return this.state();
  }
  async materialize(version: number) {
    this.assertVersion(version);
    if (!this.snapshot) {
      const bytes = await this.workbook.packageData.bytes();
      this.assertVersion(version);
      this.snapshot = { bytes, hash: createHash('sha256').update(bytes).digest('hex'), version, identity: this.history[this.cursor].identity };
    }
    return { bytes: this.snapshot.bytes, hash: this.snapshot.hash, version };
  }
  async verify(version:number,bytes:Uint8Array,hash:string){this.assertVersion(version);const expected=this.workbook.packageData;const report=await verifyOfficeCandidate(expected,bytes,hash);this.assertVersion(version);return report;}
  acknowledge(version: number, hash: string): OfficeEditState {
    if (!this.snapshot || this.snapshot.version !== version || this.snapshot.hash !== hash) throw new FileError('CHANGED', 'Office 保存回执与物化快照不一致');
    this.savedIdentity = this.snapshot.identity; this.savedFormulas=this.formulaFingerprints(); return this.state();
  }
}
