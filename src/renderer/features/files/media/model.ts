export const MEDIA_RATES = [.25, .5, .75, 1, 1.25, 1.5, 1.75, 2] as const;
export function mediaDuration(value: number): number { return Number.isFinite(value) && value > 0 ? value : 0; }
export function mediaTime(value: number): string { const seconds = Math.floor(mediaDuration(value)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
export function mediaFailure(code: number | undefined): string {
  return code === 1 ? '媒体读取已中断，请重试' : code === 2 ? '无法读取媒体，文件可能已改变或访问权限已失效' : code === 3 ? '媒体解码失败，文件可能损坏或编码不受支持' : '无法播放此媒体，文件格式或编码不受支持';
}
export function clearMediaElement(media: Pick<HTMLMediaElement, 'pause' | 'removeAttribute' | 'load'>): void { media.pause(); media.removeAttribute('src'); media.load(); }
/** Pointer-up, cancellation and lost-capture may all arrive for one drag. */
export class MediaSeekDrag {
  private pointer: number | null = null;
  private resume = false;
  begin(pointer: number, playing: boolean): void { if (this.pointer !== null) return; this.pointer = pointer; this.resume = playing; }
  end(pointer: number): boolean { if (this.pointer !== pointer) return false; const resume = this.resume; this.reset(); return resume; }
  reset(): void { this.pointer = null; this.resume = false; }
}
