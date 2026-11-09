// Original test's vi.mock('electron', factory) must intercept this resolver target.
// No real Electron module/App is loaded; unexpected execution fails closed.
throw Error('F12 original explicit Electron mock factory must be used; real Electron/App is forbidden');
