import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, FileImage, Globe, LoaderCircle, LockKeyhole } from 'lucide-react';
import './m15.css';

export const M15_TASK = 'm15-browser';
const address = 'https://reports.example.test/monthly';
const title = '月度报表';
const receipt = '示例回执 RPT-1124';
const scenarios = {
  open: { label: '开页与复用', prompt: '在右侧打开报表中心，已有标签就用原来的。' },
  login: { label: '本人登录后继续', prompt: '打开报表中心，核对十一月报表。' },
  result: { label: '观察、操作与核对', prompt: '在报表中心找到月度报表，核对十一月的生成结果。' },
  script: { label: '运行已有 CDP 测试', prompt: '在右侧标签运行已有的 CATALOG-CHOICE 测试。' },
};
const pendingLogin = ['waiting', 'checking', 'not-ready'];
const testLabels = { ready:'可运行', running:'运行中', passed:'已通过', failed:'断言未通过' };

const makeTab = (phase, id) => ({ id, url: address, title, phase });
function initialScene(scene) {
  return {
    scene,
    tab: scene === 'open' ? null : scene === 'script'
      ? { id:'m15-script', url:'https://ui-test.example.test/catalog', title:'目录测试页', phase:'ready' }
      : makeTab(scene === 'login' ? 'login' : 'ready', 'm15-' + scene),
    request: 'waiting',
    openResult: null,
    delayedRevision: null,
    checked: false,
    explored: false,
    testRun: 'ready',
    stopped: false,
  };
}

export function initialM15Scenario(search) {
  const requested = new URLSearchParams(search).get('m15');
  return Object.hasOwn(scenarios, requested) ? requested : 'open';
}

function taskStatus(state) {
  if (state.scene === 'login' && pendingLogin.includes(state.request)) return { kind: 'waiting', label: '等待登录' };
  if (state.scene === 'login' && ['cancelled', 'closed'].includes(state.request)) return { kind: 'stopped', label: '已结束' };
  if (state.stopped) return { kind: 'stopped', label: '已停止' };
  if (state.scene === 'script' && state.testRun === 'running') return { kind: 'running', label: '执行 CDP 测试' };
  if (state.scene === 'script' && state.testRun === 'failed') return { kind:'failed', label:'断言未通过' };
  if (state.scene === 'result' && !state.checked) return { kind: 'waiting', label: '待核对' };
  if (state.tab?.phase === 'failed') return { kind: 'failed', label: '加载失败' };
  if (state.tab?.phase === 'loading' || state.request === 'continued') return { kind: 'running', label: '工作中' };
  if (state.checked || state.tab?.phase === 'ready') return { kind: 'done', label: '已完成' };
  return null;
}

export function useM15Preview(initial) {
  const [state, setState] = useState(() => initialScene(initial));
  const revision = useRef(0);
  const tabSequence = useRef(0);
  const pageReady = state.tab?.phase === 'ready';

  useEffect(() => {
    if (state.request !== 'checking') return;
    const timer = setTimeout(() => {
      setState(current => ({
        ...current,
        request: pageReady ? 'continued' : 'not-ready',
      }));
    }, 450);
    return () => clearTimeout(timer);
  }, [state.request, pageReady]);

  const setViewChanged = useCallback(() => { revision.current += 1; }, []);
  const setPhase = phase => setState(current => (
    current.tab ? { ...current, tab: { ...current.tab, phase } } : current
  ));
  function open(presentation) {
    setState({
      ...state,
      tab: state.tab || makeTab('loading', 'm15-open-' + ++tabSequence.current),
      openResult: state.tab ? 'reused' : 'created',
      delayedRevision: presentation === 'delayed' ? revision.current : null,
    });
    return presentation === 'show';
  }
  function deliver() {
    if (!state.tab || state.delayedRevision === null) return false;
    setState({ ...state, delayedRevision: null });
    return state.delayedRevision === revision.current;
  }
  function close() {
    setViewChanged();
    setState(current => ({
      ...current,
      tab: null,
      delayedRevision: null,
      openResult: 'closed',
      request: current.request === 'continued' ? 'continued' : 'closed',
      stopped: current.stopped || current.scene === 'script',
    }));
  }

  return {
    state, status: taskStatus(state), open, deliver, close, setPhase, setViewChanged,
    switchScene: scene => { setViewChanged(); setState(initialScene(scene)); },
    confirm: () => setState(current => ({ ...current, request: 'checking' })),
    cancel: () => setState(current => ({ ...current, request: 'cancelled' })),
    checkResult: () => setState(current => ({ ...current, checked: true })),
    explore: () => setState(current => ({ ...current, explored: true })),
    runTest: () => setState(current => ({ ...current, testRun: 'running' })),
    finishTest: outcome => setState(current => current.stopped ? current : { ...current, testRun:outcome }),
    stop: () => setState(current => ({ ...current, stopped: true })),
  };
}

export function M15TaskPreview({ demo, selectScene, showBrowser, registerBrowser }) {
  const { state } = demo;
  const open = presentation => {
    if (demo.open(presentation)) showBrowser();
    else registerBrowser();
  };
  const usableTab = Boolean(state.tab);
  const waiting = state.scene === 'login' && pendingLogin.includes(state.request);
  const label = scenarios[state.scene];
  const testHasResult = ['passed','failed'].includes(state.testRun);

  return <section className="m14-area m15-area" aria-label="浏览器任务预览">
    <div className="m14-demobar m15-demobar">
      <label>演示 · 合成 <select aria-label="M15 合成场景" value={state.scene} onChange={e => selectScene(e.target.value)}>
        {Object.entries(scenarios).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
      </select></label>
      {state.scene === 'open' && <>
        <button type="button" onClick={() => open('show')}>请求打开</button>
        <button type="button" onClick={() => open('background')}>请求后台读取</button>
        <button type="button" onClick={() => open('delayed')}>暂存展示通知</button>
        {state.delayedRevision !== null && <button type="button" onClick={() => { if (demo.deliver()) showBrowser(); }}>送达展示通知</button>}
        {state.tab?.phase === 'loading' && <><button type="button" onClick={() => demo.setPhase('ready')}>完成网页加载</button><button type="button" onClick={() => demo.setPhase('failed')}>模拟加载失败</button></>}
      </>}
      {state.scene === 'script' && state.testRun === 'running' && !state.stopped && <>
        <button type="button" onClick={() => demo.finishTest('passed')}>模拟断言通过</button>
        <button type="button" onClick={() => demo.finishTest('failed')}>模拟断言未通过</button>
      </>}
    </div>
    <div className="m14-scroll">
      <div className="m14-timeline">
        <div className="m14-user"><div className="m14-bubble">{label.prompt}</div></div>
        {state.scene === 'open' && <div className="m15-feedback" role="status">
          {state.openResult === 'closed' ? '网页标签已关闭'
            : state.tab && <>
              {state.tab.phase === 'loading' ? <LoaderCircle size={15} className="spin" /> : <Globe size={15} />}
              {state.tab.phase === 'loading' ? '正在打开网页' : state.tab.phase === 'failed' ? '网页加载失败' : state.openResult === 'reused' ? '已复用网页标签' : '网页可操作'}
              <button type="button" className="text-button" onClick={showBrowser}>查看网页标签</button>
            </>}
        </div>}
        {state.scene === 'login' && !waiting && <p className="m15-feedback" role="status">
          {state.request === 'continued' ? <><Check size={15} />登录已核对，继续读取十一月报表</>
            : state.request === 'closed' ? '登录请求已结束，原网页标签已关闭' : '登录请求已取消'}
        </p>}
        {state.scene === 'result' && <>
          <section className="m14-biz m15-result" aria-label="当前页面观察">
            <div role="status">
              <strong>{state.explored ? '操作后已读取新页面' : '已观察当前页面'}</strong>
              <p>{state.explored ? '标题「月度报表」 · 十一月 · 可核对已有记录' : '标题「报表中心」 · 找到「月度报表」入口'}</p>
            </div>
            {!state.explored && <div className="m14-request-actions">
              <button type="button" onClick={demo.explore} disabled={!usableTab}>打开入口并读取新页面</button>
            </div>}
          </section>
          {state.explored && <section className="m14-biz m15-result" aria-label="报表操作结果">
            <div role="status"><strong>{state.checked ? '报表已核对' : '结果待核对'}</strong>
              <p>{state.checked ? '在报表中心查到原记录，编号 RPT-1124。' : '已提交生成请求，等待核对原有记录。'}</p></div>
            <details><summary>查看原回执</summary><p>生成十一月报表 · {receipt} · 工具回执未确认</p></details>
            <div className="m14-request-actions">
              <button type="button" disabled={!usableTab} onClick={showBrowser}>查看网页标签</button>
              {!state.checked && <button type="button" className="primary" disabled={!usableTab} onClick={demo.checkResult}>只读核对结果</button>}
            </div>
          </section>}
        </>}
        {state.scene === 'script' && <section className="m14-biz m15-result" aria-label="CDP 测试执行">
          <strong role="status">CDP 测试 · {state.stopped ? '已停止' : testLabels[state.testRun]}</strong>
          <p><code>CATALOG-CHOICE</code> · source-driven-ui-test</p>
          <p>目标标签「目录测试页」</p>
          <details>
            <summary>查看执行详情</summary>
            <ol className="m15-steps">
              <li><span>连接原标签并读取页面</span><small>{state.testRun !== 'ready' ? '已完成' : '未执行'}</small></li>
              <li><span>选择并断言 Option 1</span><small>{state.stopped ? '已停止' : testLabels[state.testRun]}</small></li>
              <li><span>返回页面结构与截图</span><small>{testHasResult ? '标题「目录」 · 下拉框 Choice · catalog-choice.png' : '未执行'}</small></li>
            </ol>
            {state.testRun === 'failed' && <p>预期 Option 1，实际 Option 2。</p>}
          </details>
          <div className="m14-request-actions">
            <button type="button" disabled={!usableTab} onClick={showBrowser}>查看网页标签</button>
            {!state.stopped && state.testRun === 'ready' && <button type="button" disabled={!usableTab} className="primary" onClick={demo.runTest}>运行测试</button>}
            {!state.stopped && state.testRun === 'running' && <button type="button" className="danger" onClick={demo.stop}>停止</button>}
          </div>
        </section>}
      </div>
    </div>
    <div className="m14-bottom m15-bottom">
      <div className="m14-composer-wrap">
        {waiting && <section className="m14-request" aria-label="等待你登录">
          <div className="m14-request-kicker"><LockKeyhole size={14} />等待你处理</div>
          <h2 className="m14-request-title">请在原网页标签完成登录</h2>
          <div className="m14-request-meta">reports.example.test · {title} · 项目身份</div>
          {state.request === 'checking' && <p role="status"><LoaderCircle className="spin" size={14} />正在检查登录状态</p>}
          {state.request === 'not-ready' && <p role="status">尚未进入业务页面，请在原标签完成登录。</p>}
          <div className="m14-request-actions">
            <button type="button" onClick={showBrowser}>查看网页标签</button>
            <button type="button" className="primary" disabled={state.request === 'checking'} onClick={demo.confirm}>已登录，继续</button>
            <button type="button" onClick={demo.cancel}>取消</button>
          </div>
        </section>}
        <div className="reference-composer m14-composer m15-composer">
          <textarea aria-label="任务输入（合成）" disabled placeholder={waiting ? '请先处理上方登录请求' : '随心输入'} />
        </div>
      </div>
    </div>
  </section>;
}

export function M15BrowserSurface({ demo }) {
  const { tab, checked, scene, explored, testRun } = demo.state;
  const choice = testRun === 'passed' ? 'Option 1' : testRun === 'failed' ? 'Option 2' : '等待选择';
  if (!tab) return null;
  return <div className="bw-root">
    <div className="fw-toolbar bw-toolbar"><div className="fw-breadcrumb bw-address m15-address"><Globe size={14} /><span>{tab.url}</span></div></div>
    <div className="bw-frame">
      {tab.phase === 'loading' ? <>
        <div className="bw-progress" aria-hidden="true" /><div className="bw-blank" role="status">网页加载中</div>
      </> : tab.phase === 'failed' ? <div className="bw-failure">
        <CircleAlert size={22} /><h2>网页加载失败</h2>
        <button type="button" className="button secondary" onClick={() => demo.setPhase('loading')}>重试</button>
      </div> : <div className="bw-page">
        <div className="bw-site">
          <header className="bw-site-head">{scene === 'script' ? '目录测试页' : '报表中心'}<span>合成网页</span></header>
          <section className="bw-site-card bw-wide">
            {tab.phase === 'login' ? <><h2>请登录</h2>
              <button type="button" className="button secondary" onClick={() => demo.setPhase('ready')}>本人完成登录（合成）</button>
            </> : scene === 'script' ? <>
              <h2>目录</h2><p>Choice · {choice}</p>
              {['passed','failed'].includes(testRun) && <p><FileImage size={14} /> catalog-choice.png</p>}
            </> : scene === 'result' && !explored ? <><h2>报表中心</h2><p>月度报表</p></> : <><h2>月度报表</h2><p>十一月</p>
              {checked && <p>报表编号 RPT-1124</p>}
            </>}
          </section>
        </div>
      </div>}
    </div>
  </div>;
}
