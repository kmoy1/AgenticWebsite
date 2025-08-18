import type { FixtureKey } from './types'

export const FIXTURES: Record<FixtureKey, string> = {
  login: '/fixtures/login.html',
  search: '/fixtures/search.html',
  form: '/fixtures/form.html',
}

export function injectAgent(rawHtml: string) {
  const AGENT = `
  (function(){
    function send(event, payload){
      try { parent.postMessage({ type:'agentic:event', event, payload }, '*'); } catch {}
    }
    function announceReady(){ send('ready'); }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(announceReady, 0), { once: true });
    } else {
      setTimeout(announceReady, 0);
    }
    window.addEventListener('load', () => setTimeout(announceReady, 0), { once: true });
    setTimeout(announceReady, 200);

    document.addEventListener('click', (e) => {
      const t = e.target;
      send('click', { tag: t?.tagName, id: t?.id || '', text: (t?.innerText || '').slice(0,60) });
    }, true);

    document.addEventListener('submit', (e) => {
      const f = e.target; const fd = new FormData(f); const obj = {};
      fd.forEach((v,k) => obj[k] = String(v));
      send('form_submit', obj);
    }, true);

    window.addEventListener('message', (ev) => {
      const msg = ev.data || {};
      if (msg.type !== 'agentic:command') return;
      const { command, args } = msg;
      send('command_received', { command, args });

      if (command === 'ping') { send('pong', {}); return; }

      if (command === 'fill') {
        try {
          Object.entries(args || {}).forEach(([sel, val]) => {
            const el = document.querySelector(sel);
            if (el && 'value' in el) { el.value = String(val); el.dispatchEvent(new Event('input', { bubbles: true })); }
          });
          send('autofilled', { fields: Object.keys(args || {}) });
        } catch (e) { send('error', { what:'fill', message:String(e) }); }
      }

      if (command === 'click') {
        try {
          const el = document.querySelector(args?.selector);
          if (el && el instanceof HTMLElement) { el.click(); send('clicked', { selector: args.selector }); }
          else { send('error', { what:'click', message:'selector not found' }); }
        } catch (e) { send('error', { what:'click', message:String(e) }); }
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
