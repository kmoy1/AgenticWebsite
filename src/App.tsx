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
  const [tabs, setTabs] = useState<Tab[]>(() => [{ id: crypto.randomUUID(), fixture: 'login', title: 'login' }])
  const [activeTabId, setActiveTabId] = useState(tabs[0].id)
  const [logs, setLogs] = useState<LogItem[]>([])
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId)!, [tabs, activeTabId])
  const iframeRef = useRef<HTMLIFrameElement>(null)

  async function loadFixture(tab: Tab, key: FixtureKey) {
    const res = await fetch(FIXTURES[key])
    const raw = await res.text()
    const instrumented = injectAgent(raw)
    setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, fixture: key, title: key, srcDoc: instrumented } : t))
  }

  useEffect(() => { loadFixture(activeTab, activeTab.fixture) }, [])

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
  function raise(kind: string, detail: string, tabId: string) {
    setAlerts(a => [{ ts: Date.now(), tabId, kind, detail }, ...a])
  }

  type Step =
    | { type: 'navigate', fixture: FixtureKey }
    | { type: 'fill', fields: Record<string, string> }
    | { type: 'click', selector: string }
    | { type: 'assertText', selector: string, includes: string }

  async function runWorkflow(steps: Step[]) {
    const tab = activeTab
    for (const step of steps) {
      if (step.type === 'navigate') { await loadFixture(tab, step.fixture); await waitForIframeReady() }
      if (step.type === 'fill') { postToIframe({ type: 'agentic:command', command: 'fill', args: step.fields }); await delay() }
      if (step.type === 'click') { postToIframe({ type: 'agentic:command', command: 'click', args: { selector: step.selector } }); await delay() }
      if (step.type === 'assertText') {
        const ok = await assertText(step.selector, step.includes)
        setLogs(l => [{ ts: Date.now(), tabId: tab.id, msg: ok ? `assert OK: "${step.includes}"` : `assert FAILED: "${step.includes}"` }, ...l])
      }
    }
  }

  function postToIframe(payload: any) { iframeRef.current?.contentWindow?.postMessage(payload, '*') }
  function delay(ms = 200) { return new Promise(res => setTimeout(res, ms)) }
  function waitForIframeReady(): Promise<void> {
    return new Promise(resolve => {
      const onMsg = (e: MessageEvent) => {
        if (e.data?.type === 'agentic:event' && e.data.event === 'ready') { window.removeEventListener('message', onMsg); resolve() }
      }
      window.addEventListener('message', onMsg)
    })
  }
  function assertText(selector: string, includes: string): Promise<boolean> {
    return new Promise(resolve => {
      const ch = new MessageChannel()
      ch.port1.onmessage = (e) => resolve(Boolean(e.data?.ok))
      iframeRef.current?.contentWindow?.postMessage({ type: 'agentic:command', command: 'assertText', args: { selector, includes } }, '*', [ch.port2])
      setTimeout(() => resolve(false), 800)
    })
  }

  function openTab(fixture: FixtureKey) {
    const t: Tab = { id: crypto.randomUUID(), fixture, title: fixture }
    setTabs(prev => [...prev, t]); setActiveTabId(t.id); loadFixture(t, fixture)
  }
  function closeTab(id: string) {
    setTabs(prev => prev.filter(t => t.id !== id))
    if (activeTabId === id && tabs.length > 1) {
      const next = tabs.find(t => t.id !== id)!; setActiveTabId(next.id)
    }
  }
  function titleFor(t: Tab) { return t.title }

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

function injectAgent(rawHtml: string) {
  const AGENT = `
  (function(){
    function send(event, payload){ parent.postMessage({ type:'agentic:event', event, payload }, '*'); }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => send('ready')); } else { send('ready'); }
    document.addEventListener('click', (e) => {
      const t = e.target; send('click', { tag: t?.tagName, id: t?.id || '', text: (t?.innerText || '').slice(0,60) });
    }, true);
    document.addEventListener('submit', (e) => {
      const f = e.target; const fd = new FormData(f); const obj = {}; fd.forEach((v,k) => obj[k] = String(v)); send('form_submit', obj);
    }, true);
    window.addEventListener('message', (ev) => {
      const msg = ev.data || {}; if (msg.type !== 'agentic:command') return;
      const { command, args } = msg;
      if (command === 'fill') {
        try { Object.entries(args || {}).forEach(([sel, val]) => { const el = document.querySelector(sel); if (el) { el.value = String(val); el.dispatchEvent(new Event('input', { bubbles: true })); }});
              send('autofilled', { fields: Object.keys(args || {}) }); } catch (e) { send('error', { what: 'fill', message: String(e) }); }
      }
      if (command === 'click') {
        try { const el = document.querySelector(args?.selector); if (el) { el.click(); send('clicked', { selector: args.selector }); } else { send('error', { what:'click', message:'selector not found' }); } }
        catch (e) { send('error', { what: 'click', message: String(e) }); }
      }
      if (command === 'assertText') {
        try { const el = document.querySelector(args?.selector); const ok = !!el && (el.textContent || '').includes(args?.includes || '');
              if (ev.ports && ev.ports[0]) { ev.ports[0].postMessage({ ok }); } send('assert_result', { selector: args?.selector, includes: args?.includes, ok }); }
        catch (e) { send('error', { what:'assertText', message:String(e) }); }
      }
    });
  })();`
  if (rawHtml.includes('</body>')) return rawHtml.replace('</body>', `<script>${AGENT}</script></body>`)
  return `${rawHtml}<script>${AGENT}</script>`
}
