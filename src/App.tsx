import { useEffect, useMemo, useRef, useState } from 'react'

type Tab = { id: string; fixture: FixtureKey; title: string; srcDoc?: string }
type FixtureKey = 'login' | 'search' | 'form'
const FIXTURES: Record<FixtureKey, string> = {
  login: '/fixtures/login.html',
  search: '/fixtures/search.html',
  form: '/fixtures/form.html',
}
type LogItem = { ts: number; tabId: string; msg: string }
type AlertItem = { ts: number; tabId: string; kind: string; detail: string }

export default function App() {
  // Initialize list of open browser tabs, with one elmt as Login page and set it as active.
  const [tabs, setTabs] = useState<Tab[]>(() => [{ id: crypto.randomUUID(), fixture: 'login', title: 'login' }])
  const [activeTabId, setActiveTabId] = useState(tabs[0].id)
  // Initialize agent events logs list. 
  const [logs, setLogs] = useState<LogItem[]>([])

  // Initialize list of security alerts that sandbox raises.
  const [alerts, setAlerts] = useState<AlertItem[]>([])

  // Look at open tabs + current tab ID, and give actual Tab object.  
  // useMemo is React hook that caches the active tab until tabs or activeTabId changes (when it then refreshes)
  const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId)!, [tabs, activeTabId])

  // Give reference to iframe DOM element that React renders; usually we let React manage it, 
  // but in this case we need to communicate with the login iframe. 
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Called on navigating to new tab, e.g. switch from login to form tab. 
  // Gets HTML, loads script, updates entry in tabs.
  async function loadFixture(tab: Tab, key: FixtureKey) {
    // Fetch fixture HTML file
    const res = await fetch(FIXTURES[key])
    // Read as plain text
    const raw = await res.text()
    // INJECT agent JS into HTML, so we capture click/submit events
    const instrumented = injectAgent(raw)
    // Take current list of tabs, and update the ONE CORRECT tab that matches tab.id with new content
    setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, fixture: key, title: key, srcDoc: instrumented } : t))
    console.log("Finished loading fixture");
  }

  // Actually loads the fixture into the first tab (login) once React app mounts. 
  useEffect(() => { loadFixture(activeTab, activeTab.fixture) }, [])

  // Set up listener to iframe, which reruns on every tab change.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const data = e.data
      if (!data || !data.type) return
      if (data.type === 'agentic:event') {
        const { event, payload } = data
        setLogs(l => [{ ts: Date.now(), tabId: activeTabId, msg: `${event} ${payload ? JSON.stringify(payload) : ''}` }, ...l])
        runSecurityChecks(event, payload, activeTabId)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [activeTabId])

  // Set up security rules engine; inspect every event from iframe and decide to raise alert or not.
  function runSecurityChecks(event: string, payload: any, tabId: string) {
    if (event === 'form_submit' && payload && typeof payload === 'object') {
      if (Object.keys(payload).some(k => k.toLowerCase().includes('pass'))) raise('SensitiveSubmit', 'Form submitted with a password field.', tabId)
      const values = Object.values(payload).map(String).join(' ')
      if (values.includes('<script')) raise('PotentialXSS', 'User input contained "<script".', tabId)
    }
    if (event === 'click') {
      const now = Date.now()
      const recent = logs.filter(x => (now - x.ts) < 800 && x.msg.startsWith('click')).length
      if (recent >= 4) raise('ClickStorm', 'Rapid clicking detected.', tabId)
    }
  }

  // Log an alert into alerts state, used by security rules checker.
  function raise(kind: string, detail: string, tabId: string) {
    setAlerts(a => [{ ts: Date.now(), tabId, kind, detail }, ...a])
  }

  type Step =
    | { type: 'navigate', fixture: FixtureKey }
    | { type: 'fill', fields: Record<string, string> }
    | { type: 'click', selector: string }
    | { type: 'assertText', selector: string, includes: string }

  // Given a list of steps, tell the agent to run those steps in the iframe.
  async function runWorkflow(steps: Step[]) {
    console.log("RUNNING SAMPLE WORKFLOW");
    const tab = activeTab
    console.log("ACTIVE TAB: " + tab.title);
    for (const step of steps) {
      console.log("On step " + step.type);
      if (step.type === 'navigate') { await loadFixture(tab, step.fixture); await waitForIframeReady() }
      if (step.type === 'fill') { postToIframe({ type: 'agentic:command', command: 'fill', args: step.fields }); await delay() }
      if (step.type === 'click') { postToIframe({ type: 'agentic:command', command: 'click', args: { selector: step.selector } }); await delay() }
      if (step.type === 'assertText') {
        const ok = await assertText(step.selector, step.includes)
        setLogs(l => [{ ts: Date.now(), tabId: tab.id, msg: ok ? `assert OK: "${step.includes}"` : `assert FAILED: "${step.includes}"` }, ...l])
      }
    }
  }

  // Send JSON messages into the iframe's Javascript context, where the agent listens and performs actions.
  function postToIframe(payload: any) { iframeRef.current?.contentWindow?.postMessage(payload, '*') }

  // Pause execution for 200 ms
  function delay(ms = 200) { return new Promise(res => setTimeout(res, ms)) }

  // Pause until iframe is ready.
  function waitForIframeReady(): Promise<void> {
  return new Promise(resolve => {
      let done = false
      const finish = () => { if (done) return; done = true; cleanup(); resolve() }

      const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'agentic:event' && e.data.event === 'ready') finish()
      }

      const iframe = iframeRef.current
      const onLoad = () => finish()

      const cleanup = () => {
      window.removeEventListener('message', onMsg)
      iframe?.removeEventListener('load', onLoad as any)
      clearTimeout(tid)
      }

      window.addEventListener('message', onMsg)
      iframe?.addEventListener('load', onLoad, { once: true } as any)

      // hard stop so we never hang forever
      const tid = setTimeout(finish, 2500)
  })
  }

  // Asserts if element <selector> contains text "includes" in the iframe.
  function assertText(selector: string, includes: string): Promise<boolean> {
    return new Promise(resolve => {
      const ch = new MessageChannel()
      ch.port1.onmessage = (e) => resolve(Boolean(e.data?.ok))
      iframeRef.current?.contentWindow?.postMessage({ type: 'agentic:command', command: 'assertText', args: { selector, includes } }, '*', [ch.port2])
      setTimeout(() => resolve(false), 800)
    })
  }

  // Open a new tab and load fixture into it.
  function openTab(fixture: FixtureKey) {
    const t: Tab = { id: crypto.randomUUID(), fixture, title: fixture }
    setTabs(prev => [...prev, t]); setActiveTabId(t.id); loadFixture(t, fixture)
  }

  // Closes tab and picks new active tab.
  function closeTab(id: string) {
    setTabs(prev => prev.filter(t => t.id !== id))
    if (activeTabId === id && tabs.length > 1) {
      const next = tabs.find(t => t.id !== id)!; setActiveTabId(next.id)
    }
  }

  // Gets title of tab.
  function titleFor(t: Tab) { return t.title }

  // SAMPLE workflow of agent interacting with browser iframe.
  const sampleWorkflow: Step[] = [
    { type: 'navigate', fixture: 'login' },
    { type: 'fill', fields: { '#username': 'alice', '#password': 'secret123' } },
    { type: 'click', selector: '#login-btn' },
    { type: 'assertText', selector: '#status', includes: 'Welcome, alice!' },
    { type: 'navigate', fixture: 'search' },
    { type: 'fill', fields: { '#q': 'agent safety' } },
    { type: 'click', selector: '#go' },
    { type: 'assertText', selector: '#results', includes: 'Result A' },
  ]

  return (
    <div className="aw-shell">
      {/* Header */}
      <header className="aw-header py-2">
        <div className="container-fluid d-flex justify-content-between align-items-center">
          <div className="d-flex align-items-center gap-2">
            <span className="badge bg-primary aw-pill">AgenticWebsite</span>
            <div className="d-none d-md-inline text-secondary small">Simulated Chromium Sandbox</div>
          </div>
          <div className="aw-toolbar d-flex gap-2">
            <button className="btn btn-outline-light btn-sm" onClick={() => openTab('login')}>+ Login</button>
            <button className="btn btn-outline-light btn-sm" onClick={() => openTab('search')}>+ Search</button>
            <button className="btn btn-outline-light btn-sm" onClick={() => openTab('form')}>+ Form</button>
            <button className="btn btn-success btn-sm" onClick={() => runWorkflow(sampleWorkflow)}>Run Sample</button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="aw-main container-fluid">
        <div className="row g-3" style={{ minHeight: 'calc(100vh - 80px)' }}>
          {/* Left pane: viewport */}
          <div className="col-12 col-xl-8 d-flex flex-column">
            <div className="card aw-card flex-fill">
              <div className="card-header">
                {/* Tabs as pills */}
                <div className="d-flex flex-wrap gap-2">
                  {tabs.map(t => (
                    <div key={t.id} className="btn-group">
                      <button
                        onClick={() => setActiveTabId(t.id)}
                        className={`btn btn-sm aw-pill ${t.id === activeTabId ? 'btn-primary' : 'btn-outline-primary'}`}>
                        {titleFor(t)}
                      </button>
                      <button
                        onClick={() => closeTab(t.id)}
                        className="btn btn-sm btn-outline-danger aw-pill">×</button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="px-3 pb-3">
                {/* Address/controls */}
                <div className="input-group">
                  <span className="input-group-text">fixture://</span>
                  <select
                    className="form-select"
                    value={activeTab.fixture}
                    onChange={(e) => loadFixture(activeTab, e.target.value as FixtureKey)}
                  >
                    <option value="login">login</option>
                    <option value="search">search</option>
                    <option value="form">form</option>
                  </select>
                  <button className="btn btn-outline-secondary" onClick={() => loadFixture(activeTab, activeTab.fixture)}>Reload</button>
                </div>
              </div>

              {/* Tall iframe */}
              <div style={{ flex: 1, minHeight: 0, height: '60vh' }} className="px-3 pb-3">
                <iframe ref={iframeRef} title="viewport" className="aw-iframe" srcDoc={activeTab.srcDoc} />
              </div>
            </div>
          </div>

          {/* Right pane: console + security */}
          <div className="col-12 col-xl-4 d-flex flex-column">
            <div className="card aw-card mb-3">
              <div className="card-header d-flex justify-content-between">
                <span>Agent Console</span>
                <span className="badge text-bg-dark aw-pill">{logs.length}</span>
              </div>
              <div className="card-body">
                <div className="aw-console" style={{ maxHeight: 220, overflow: 'auto' }}>
                  {logs.slice(0, 80).map((l, i) => (
                    <div key={i}>
                      <span className="text-secondary">{new Date(l.ts).toLocaleTimeString()} </span>
                      <span>{l.msg}</span>
                    </div>
                  ))}
                  {logs.length === 0 && <div className="text-secondary">No events yet.</div>}
                </div>
              </div>
            </div>

            <div className="card aw-card flex-fill">
              <div className="card-header d-flex justify-content-between">
                <span>Security Monitor</span>
                <span className={`badge ${alerts.length ? 'text-bg-danger' : 'text-bg-secondary'} aw-pill`}>
                  {alerts.length || '0'}
                </span>
              </div>
              <div className="card-body" style={{ overflow: 'auto' }}>
                {alerts.length === 0 && <div className="text-secondary small">No alerts yet.</div>}
                {alerts.map((a, i) => (
                  <div key={i} className="small d-flex align-items-start gap-2 mb-2">
                    <span className="badge text-bg-danger aw-pill">{a.kind}</span>
                    <div>
                      <div>{a.detail}</div>
                      <div className="text-secondary">{new Date(a.ts).toLocaleTimeString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}

// TODO: Why are we injecting agents? 
function injectAgent(rawHtml: string) {
  const AGENT = `
  (function(){
    function send(event, payload){
      try { parent.postMessage({ type:'agentic:event', event, payload }, '*'); } catch {}
    }

    // --- Robust "ready" announcements to avoid races ---
    function announceReady(){ send('ready'); }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(announceReady, 0), { once: true });
    } else {
      setTimeout(announceReady, 0);
    }
    // also when the full page finishes loading (images, css, etc.)
    window.addEventListener('load', () => setTimeout(announceReady, 0), { once: true });
    // small delayed ping as belt-and-suspenders
    setTimeout(announceReady, 200);

    // --- Surface basic user interactions ---
    document.addEventListener('click', (e) => {
      const t = e.target;
      send('click', { tag: t?.tagName, id: t?.id || '', text: (t?.innerText || '').slice(0,60) });
    }, true);

    document.addEventListener('submit', (e) => {
      const f = e.target;
      const fd = new FormData(f);
      const obj = {};
      fd.forEach((v,k) => obj[k] = String(v));
      send('form_submit', obj);
    }, true);

    // --- Command handler from parent ---
    window.addEventListener('message', (ev) => {
      const msg = ev.data || {};
      if (msg.type !== 'agentic:command') return;
      const { command, args } = msg;

      // visibility: show that a command was received
      send('command_received', { command, args });

      if (command === 'ping') {
        send('pong', {});
        return;
      }

      if (command === 'fill') {
        try {
          Object.entries(args || {}).forEach(([sel, val]) => {
            const el = document.querySelector(sel);
            if (el && 'value' in el) {
              el.value = String(val);
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          });
          send('autofilled', { fields: Object.keys(args || {}) });
        } catch (e) { send('error', { what: 'fill', message: String(e) }); }
      }

      if (command === 'click') {
        try {
          const el = document.querySelector(args?.selector);
          if (el && el instanceof HTMLElement) {
            el.click();
            send('clicked', { selector: args.selector });
          } else {
            send('error', { what:'click', message:'selector not found' });
          }
        } catch (e) { send('error', { what: 'click', message: String(e) }); }
      }

      if (command === 'assertText') {
        try {
          const el = document.querySelector(args?.selector);
          const ok = !!el && (el.textContent || '').includes(args?.includes || '');
          if (ev.ports && ev.ports[0]) { ev.ports[0].postMessage({ ok }); }
          send('assert_result', { selector: args?.selector, includes: args?.includes, ok });
        } catch (e) { send('error', { what:'assertText', message:String(e) }); }
      }
    });
  })();`
  if (rawHtml.includes('</body>')) return rawHtml.replace('</body>', `<script>${AGENT}</script></body>`)
  return `${rawHtml}<script>${AGENT}</script>`
}
