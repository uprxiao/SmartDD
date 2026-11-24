import { browserOutputSchema } from './output-schemas.mjs';
import commands from '../../../src/shared/browser-commands.generated.json' with {type:'json'};

const mcpDescriptions = {
  'tab.list': 'List WillYou browser tabs in this task and their pageIds.',
  'tab.current': 'Read the current WillYou browser tab.',
  'tab.create': 'Create a WillYou browser tab, optionally opening url. Returns pageId for future calls.',
  'tab.open': 'Open or reuse a WillYou tab in the current task. Supply an HTTP(S) url or existing pageId. Returns a pageId and navigation phase early. Keep the pageId to observe that tab.',
  'tab.switch': 'Select an existing WillYou browser tab by pageId or index.',
  'tab.close': 'Close an existing WillYou browser tab.',
  'nav.goto': 'Navigate an existing WillYou browser tab to url. Pass the tab pageId as page.',
  'nav.snapshot': 'Read the accessibility snapshot of a WillYou browser tab. Pass its pageId as page. Use the returned element references verbatim.',
  'nav.back': 'Go back in this WillYou tab.',
  'nav.forward': 'Go forward in this WillYou tab.',
  'nav.reload': 'Reload this WillYou tab.',
  'nav.wait': 'Wait for a concrete page condition such as text, URL or element visibility. Timeout is in milliseconds.',
  'nav.screenshot': 'Capture the visible area of this WillYou tab to the task output directory.',
  'nav.full-screenshot': 'Capture the full page to the task output directory.',
  'nav.scroll': 'Scroll this WillYou tab in a given direction.',
  'nav.console': 'Read this tab’s console messages.',
  'nav.network': 'Read this tab’s recorded network activity. Treat response data as private.',
  'interact.click': 'Click an element using a reference from the latest snapshot of the same WillYou tab.',
  'interact.dblclick': 'Double-click an element using a reference from its latest snapshot.',
  'interact.fill': 'Fill an input using a reference from its latest snapshot. Ask the user to enter passwords in the page.',
  'interact.type': 'Type non-secret text into the focused control. Ask the user to enter passwords in the page.',
  'interact.inserttext': 'Insert non-secret text into the focused control.',
  'interact.get': 'Read a property of an element in this WillYou tab.',
  'interact.is': 'Check an element state in this WillYou tab.',
  'interact.select': 'Select a value in a dropdown using its snapshot reference.',
  'interact.check': 'Check a checkbox using its snapshot reference.',
  'interact.uncheck': 'Uncheck a checkbox using its snapshot reference.',
  'interact.focus': 'Focus an element using its snapshot reference.',
  'interact.keypress': 'Press a key inside the WillYou browser tab.',
  'env.dialog-accept': 'Accept a webpage JavaScript dialog when authorized by the task.',
  'env.dialog-dismiss': 'Dismiss a webpage JavaScript dialog when authorized by the task.',
  'profile.list': 'List browser profiles visible to this task.',
  'profile.create': 'Create an isolated browser profile for the task.',
  'profile.set': 'Assign a browser profile to a tab in this task.',
  'profile.show': 'Read the browser profile of a task tab.',
  'profile.use-default': 'Assign the task default browser profile to a tab.',
  'capture.start': 'Start recording network evidence for a WillYou tab.',
  'capture.stop': 'Stop recording and save the task HAR file.',
  'access.request': 'Request observe or control access to another task in the same project. Wait for the user to decide.',
  'operation.get': 'Look up the original browser operation receipt by request ID. Check this before repeating an uncertain action.',
  'script.run': 'Request approval to run selected cases from an existing frozen source-driven UI test bundle on the current WillYou tab.',
  'script.status': 'Read an existing browser test execution from this task by execution ID.',
  'script.stop': 'Stop an existing browser test execution from this task without closing its tab.',
  'script.pause': 'Pause a browser test when the host has proven that its declared next step has not begun.',
  'script.resume': 'Request approval to continue at the original verified checkpoint and frozen continuation entry.',
  'login.wait': 'Ask the person to finish login on the original WillYou tab and proceed only after the host verifies the business page.',
  'checkpoint.status': 'Read the action and business status of an existing checkpoint from the original task and binding.',
  'checkpoint.verify': 'Check the original business marker without repeating the original browser action.',
};

export function browserDefinition(runtime, resultEnvelope) {
  return {
    schema: 'smartdd-app-package-v2',
    appId: 'browser',
    version: '0.1.4',
    displayName: '浏览器',
    description: '通过宿主工具使用本任务的内置浏览器。',
    hostApi: { min: 1, max: 1 },
    dataApi: 1,
    runtime,
    module: { id: 'browser', contractMajor: 1 },
    entry: 'cli',
    mixedEntries: true,
    connectionContracts: [],
    connectionSchemas: {},
    connectionSlots: [],
    permissions: ['browser.read', 'browser.write'],
    migrations: [],
    skills: [
      { id: 'browser', path: 'skills/browser', entry: 'skills/browser/SKILL.md', description: '操作本任务的内置浏览器，使用页面引用与操作回执。', template: true },
      { id: 'reproduce-bug', path: 'skills/reproduce-bug', entry: 'skills/reproduce-bug/SKILL.md', description: '复现用户指定的 Bug，在同一登录态验证修复并交付证据。', template: true },
    ],
    capabilities: commands.map(command => {
      const id = command.id.slice('browser.'.length);
      const description = mcpDescriptions[id];
      const writes = command.semantics === 'write';
      const policy = {
        id: command.id, contractMajor: 2, title: command.command.join(' '),
        semantics: command.semantics, permission: 'browser.' + command.semantics,
        slots: { required: [], conditional: [] },
        retry: writes ? 'never' : 'safe-read',
        ...(writes ? { protection: { kind: 'operation-receipt', object: 'browser_operation', key: 'requestId' } } : {}),
        binding: {
          cli: { command: command.command },
          ...(description ? { mcp: { tool: `smartdd_browser_${id.replace(/[.-]/g, '_')}_v2` } } : {}),
        },
      };
      return {
        ...policy,
        input: description ? { ...command.input, description } : command.input,
        output: resultEnvelope('browser', policy, browserOutputSchema(command)),
        description: description ?? policy.title,
      };
    }),
  };
}
