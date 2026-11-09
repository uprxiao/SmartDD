// Menu layout follows Yoda (Apache-2.0) src/main/app/menu.ts.
import { Menu, type MenuItemConstructorOptions } from 'electron';
import type { Language } from '@shared/app-settings';
import { APP_NAME } from './identity';

const LABELS = {
  'zh-CN': {
    about: '关于 WillYou',
    settings: '设置…',
    services: '服务',
    hide: '隐藏 WillYou',
    hideOthers: '隐藏其他',
    unhide: '全部显示',
    quit: '退出 WillYou',
    edit: '编辑',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    selectAll: '全选',
    view: '视图',
    toggleSidebar: '显示/隐藏左侧边栏',
    reload: '重新加载',
    forceReload: '强制重新加载',
    devTools: '开发者工具',
    resetZoom: '实际大小',
    zoomIn: '放大',
    zoomOut: '缩小',
    fullscreen: '切换全屏',
    window: '窗口',
    minimize: '最小化',
    zoom: '缩放',
    close: '关闭窗口',
  },
  en: {
    about: 'About WillYou',
    settings: 'Settings…',
    services: 'Services',
    hide: 'Hide WillYou',
    hideOthers: 'Hide Others',
    unhide: 'Show All',
    quit: 'Quit WillYou',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    view: 'View',
    toggleSidebar: 'Toggle Left Sidebar',
    reload: 'Reload',
    forceReload: 'Force Reload',
    devTools: 'Toggle Developer Tools',
    resetZoom: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    fullscreen: 'Toggle Full Screen',
    window: 'Window',
    minimize: 'Minimize',
    zoom: 'Zoom',
    close: 'Close Window',
  },
} satisfies Record<Language, Record<string, string>>;

export interface MenuActions {
  openSettings: () => void;
  toggleLeftSidebar: () => void;
}

export function buildAppMenu(language: Language, actions: MenuActions): void {
  const l = LABELS[language];
  const template: MenuItemConstructorOptions[] = [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about', label: l.about },
        { type: 'separator' },
        { label: l.settings, accelerator: 'CmdOrCtrl+,', click: actions.openSettings },
        { type: 'separator' },
        { role: 'services', label: l.services },
        { type: 'separator' },
        { role: 'hide', label: l.hide },
        { role: 'hideOthers', label: l.hideOthers },
        { role: 'unhide', label: l.unhide },
        { type: 'separator' },
        { role: 'quit', label: l.quit },
      ],
    },
    {
      label: l.edit,
      submenu: [
        { role: 'undo', label: l.undo },
        { role: 'redo', label: l.redo },
        { type: 'separator' },
        { role: 'cut', label: l.cut },
        { role: 'copy', label: l.copy },
        { role: 'paste', label: l.paste },
        { role: 'selectAll', label: l.selectAll },
      ],
    },
    {
      label: l.view,
      submenu: [
        { label: l.toggleSidebar, accelerator: 'CmdOrCtrl+B', click: actions.toggleLeftSidebar },
        { type: 'separator' },
        { role: 'reload', label: l.reload },
        { role: 'forceReload', label: l.forceReload },
        { role: 'toggleDevTools', label: l.devTools },
        { type: 'separator' },
        { role: 'resetZoom', label: l.resetZoom },
        { role: 'zoomIn', label: l.zoomIn },
        { role: 'zoomOut', label: l.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: l.fullscreen },
      ],
    },
    {
      label: l.window,
      role: 'window',
      submenu: [
        { role: 'minimize', label: l.minimize },
        { role: 'zoom', label: l.zoom },
        { role: 'close', label: l.close },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
