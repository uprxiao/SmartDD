import { i18n, processFile } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { useMemo } from 'react';

i18n.set({ locale: 'zh-CN', messages: {
  unmodifiedLines: '{count} 行未改动',
  unknownUnmodifiedLines: '未改动的上下文',
  expandAll: '展开全部',
  noNewlineAtEndOfFile: '文件末尾没有换行',
} });

// Keep a long line from forcing the other column to keep changing width.
const splitWrapCss = '[data-diff-type="split"][data-overflow="wrap"] { --diffs-code-grid: var(--diffs-grid-number-column-width) minmax(0, 1fr); }';

export default function TurnPatchView({ path, patch, before, after, split, wrap }: {
  path: string;
  patch: string;
  before?: string;
  after?: string;
  split: boolean;
  wrap: boolean;
}) {
  const file = useMemo(() => {
    try {
      return processFile(patch, {
        oldFile: before === undefined ? undefined : { name: path, contents: before },
        newFile: after === undefined ? undefined : { name: path, contents: after },
        throwOnError: true,
      });
    } catch {
      return undefined;
    }
  }, [path, patch, before, after]);

  if (!file?.hunks.length) {
    return <pre className="agent-diff-raw" data-wrap={wrap} tabIndex={0} aria-label="原始差异">{patch || '没有文本行变更'}</pre>;
  }
  return <FileDiff fileDiff={file} className="agent-patch-lines" options={{
    diffStyle: split ? 'split' : 'unified',
    overflow: wrap ? 'wrap' : 'scroll',
    diffIndicators: 'classic',
    disableFileHeader: true,
    hunkSeparators: 'line-info',
    lineDiffType: 'none',
    tokenizeMaxLineLength: 1_000,
    unsafeCSS: splitWrapCss,
  }}/>;
}
