export type FixtureKey = 'login' | 'search' | 'form'

export type Tab = {
  id: string
  fixture: FixtureKey
  title: string
  srcDoc?: string
}

export type LogItem = { ts: number; tabId: string; msg: string }
export type AlertItem = { ts: number; tabId: string; kind: string; detail: string }

export type Step =
  | { type: 'navigate', fixture: FixtureKey }
  | { type: 'fill', fields: Record<string, string> }
  | { type: 'click', selector: string }
  | { type: 'assertText', selector: string, includes: string }
