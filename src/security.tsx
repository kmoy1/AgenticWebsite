import type { LogItem } from './types'

export function createSecurityChecker(opts: {
  getLogs: () => LogItem[]
  raise: (kind: string, detail: string, tabId: string) => void
}) {
  return function runSecurityChecks(event: string, payload: any, tabId: string) {
    if (event === 'form_submit' && payload && typeof payload === 'object') {
      if (Object.keys(payload).some(k => k.toLowerCase().includes('pass')))
        opts.raise('SensitiveSubmit', 'Form submitted with a password field.', tabId)

      const values = Object.values(payload).map(String).join(' ')
      if (values.includes('<script'))
        opts.raise('PotentialXSS', 'User input contained "<script".', tabId)
    }

    if (event === 'click') {
      const now = Date.now()
      const recent = opts.getLogs().filter(x => (now - x.ts) < 800 && x.msg.startsWith('click')).length
      if (recent >= 4)
        opts.raise('ClickStorm', 'Rapid clicking detected.', tabId)
    }
  }
}