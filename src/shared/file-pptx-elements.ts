import type { PptxTableInfo } from './file-pptx-table';
import type { PptxTextStyle } from './file-pptx-format';
import type { PptxAppearance } from './file-pptx-appearance';
import type { PptxChartInfo } from './file-pptx-chart';
/** DrawingML positions use points here; OOXML storage remains in EMU. These
 * are source properties, not guessed bounds from a PDF text layer. */
export interface PptxElementBox {x:number;y:number;width:number;height:number;rotation:number;flipH:boolean;flipV:boolean}
export type PptxChildFrame=Pick<PptxElementBox,'x'|'y'|'width'|'height'>;
export interface PptxElementInfo {
  id:string;name:string;kind:'text'|'shape'|'image'|'table'|'chart'|'group'|'connector'|'other';
  parentId?:string;box?:PptxElementBox;boxSource?:'local'|'layout'|'master';childFrame?:PptxChildFrame;pageBox?:PptxElementBox;text?:string;textStyle?:PptxTextStyle;appearance?:PptxAppearance;table?:PptxTableInfo;chart?:PptxChartInfo;preset?:string;hidden:boolean;
}
export const PPTX_SHAPES=['rect','circle','triangle','diamond','star','arrow','left-arrow','plus','chevron','callout','line'] as const;
export const PPTX_PRESETS:Record<typeof PPTX_SHAPES[number],string>={rect:'rect',circle:'ellipse',triangle:'triangle',diamond:'diamond',star:'star5',arrow:'rightArrow','left-arrow':'leftArrow',plus:'plus',chevron:'chevron',callout:'wedgeRectCallout',line:'line'};
