// Pure geometry/content predicate; cannot navigate or alter App state.
export const isTargetPageReady=s=>Boolean(s&&s.status?.includes('第 3 / 3 页')&&s.zoom?.includes('150%')&&s.bestPage===3&&s.page3?.visibleArea>0&&s.page3?.canvasRendered&&s.page3?.markerText?.includes('PAGE_THREE_MARKER'));
