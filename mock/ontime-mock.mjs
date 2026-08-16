/**
 * Tiny mock of the Ontime v4 API — dev/QA utility only.
 *
 * Implements the four routes Show Flow Sync uses, with the same shapes as the
 * verified Ontime source (rundown.router.ts / customFields.router.ts):
 *   GET  /data/rundowns
 *   GET  /data/rundowns/current
 *   GET  /data/custom-fields
 *   POST /data/rundowns/import   { mode, targetRundownId, rundown, customFields, providedFields }
 *
 * Run:  node mock/ontime-mock.mjs            (port 4111)
 *       PORT=4001 node mock/ontime-mock.mjs  (mimic a real venue machine)
 *       MOCK_TOKEN=secret node mock/ontime-mock.mjs   (require an API token)
 */
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 4111);
const TOKEN = process.env.MOCK_TOKEN ?? '';

/** Seeded "last week's" rundown so the diff view has added / removed / changed rows. */
function seedRundown() {
  const entries = {
    mk000001: {
      id: 'mk000001',
      type: 'event',
      flag: false,
      title: 'Carlton Rehearsal',
      timeStart: 63000000,
      timeEnd: 66600000,
      duration: 3600000,
      timeStrategy: 'lock-duration',
      linkStart: false,
      endAction: 'none',
      timerType: 'none',
      countToEnd: false,
      skip: false,
      note: '',
      colour: '#77C785',
      delay: 0,
      dayOffset: 0,
      gap: 0,
      cue: '1',
      parent: null,
      revision: 0,
      timeWarning: 120000,
      timeDanger: 60000,
      custom: { Screenstate: 'SS1' },
      triggers: [],
    },
    mk000002: {
      id: 'mk000002',
      type: 'event',
      flag: false,
      title: 'Reception Starts (old title)',
      timeStart: 66600000,
      timeEnd: 68400000,
      duration: 1800000,
      timeStrategy: 'lock-duration',
      linkStart: true,
      endAction: 'none',
      timerType: 'none',
      countToEnd: false,
      skip: false,
      note: 'Lobby only',
      colour: '#779BE7',
      delay: 0,
      dayOffset: 0,
      gap: 0,
      cue: '2',
      parent: null,
      revision: 0,
      timeWarning: 120000,
      timeDanger: 60000,
      custom: { Screenstate: 'SS3' },
      triggers: [],
    },
    mk000999: {
      id: 'mk000999',
      type: 'event',
      flag: false,
      title: 'Cut segment — Sponsor Reel',
      timeStart: 68400000,
      timeEnd: 68700000,
      duration: 300000,
      timeStrategy: 'lock-duration',
      linkStart: true,
      endAction: 'none',
      timerType: 'none',
      countToEnd: false,
      skip: false,
      note: '',
      colour: '#FFCC78',
      delay: 0,
      dayOffset: 0,
      gap: 0,
      cue: '999',
      parent: null,
      revision: 0,
      timeWarning: 120000,
      timeDanger: 60000,
      custom: {},
      triggers: [],
    },
  };
  const order = Object.keys(entries);
  return { id: 'default', title: 'Last Week Rehearsal Rundown', order, flatOrder: [...order], entries, revision: 3 };
}

const state = {
  loaded: 'default',
  rundowns: { default: seedRundown() },
  customFields: {
    Screenstate: { type: 'text', colour: '#9E9E9E', label: 'Screenstate' },
    Legacy_Notes: { type: 'text', colour: '#666666', label: 'Legacy Notes' },
  },
  // Seeded with one "hand-made" automation so QA can verify a sync preserves it.
  automation: {
    enabledAutomations: false,
    enabledOscIn: true,
    oscPortIn: 8899,
    triggers: [
      { id: 'manual01', title: 'House lights on load', trigger: 'onLoad', automationId: 'manualA1' },
    ],
    automations: {
      manualA1: {
        id: 'manualA1',
        title: 'House lights on load',
        filterRule: 'all',
        filters: [],
        outputs: [{ type: 'ontime', action: 'message-set', text: 'lights', visible: true }],
      },
    },
  },
};

/** Last credentials seen by the mock — inspect with GET /__last-auth. */
let lastAuth = null;

const send = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

const summarise = (r) => ({
  id: r.id,
  title: r.title,
  numEntries: r.order.length,
  revision: r.revision,
});

const rundownList = () => ({
  loaded: state.loaded,
  rundowns: Object.values(state.rundowns).map(summarise),
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // Record what credentials arrived, so tests can assert the proxy sends both forms.
  if (path !== '/__last-auth') {
    lastAuth = {
      method: req.method,
      path,
      authorization: req.headers.authorization ?? null,
      tokenQuery: url.searchParams.get('token'),
      at: new Date().toISOString(),
    };
  }

  if (TOKEN) {
    const header = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const query = url.searchParams.get('token') ?? '';
    if (header !== TOKEN && query !== TOKEN) {
      return send(res, 401, { message: 'Invalid API token' });
    }
  }

  if (req.method === 'GET' && path === '/data/rundowns') return send(res, 200, rundownList());
  if (req.method === 'GET' && path === '/data/rundowns/current')
    return send(res, 200, state.rundowns[state.loaded]);
  if (req.method === 'GET' && path === '/data/custom-fields') return send(res, 200, state.customFields);
  if (req.method === 'GET' && path.startsWith('/data/rundowns/')) {
    const id = decodeURIComponent(path.slice('/data/rundowns/'.length));
    const found = state.rundowns[id];
    if (!found) return send(res, 404, { message: `rundown ${id} not found` });
    return send(res, 200, found);
  }
  if (req.method === 'GET' && path === '/__last-auth') return send(res, 200, lastAuth ?? {});

  if (req.method === 'GET' && path === '/data/automations') return send(res, 200, state.automation);

  if (req.method === 'POST' && path === '/data/automations') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return send(res, 400, { message: 'Invalid JSON body' });
    }
    if (typeof body.enabledAutomations !== 'boolean' || typeof body.enabledOscIn !== 'boolean') {
      return send(res, 400, { message: 'enabledAutomations and enabledOscIn booleans are required' });
    }
    if (!Number.isInteger(body.oscPortIn) || body.oscPortIn < 1024 || body.oscPortIn > 65535) {
      return send(res, 400, { message: 'oscPortIn must be a port number' });
    }
    const triggers = body.triggers ?? [];
    const automations = body.automations ?? {};
    if (!Array.isArray(triggers) || typeof automations !== 'object' || automations === null) {
      return send(res, 400, { message: 'triggers must be an array and automations an object' });
    }
    const lifecycles = ['onLoad', 'onStart', 'onPause', 'onStop', 'onClock', 'onUpdate', 'onFinish', 'onWarning', 'onDanger'];
    for (const t of triggers) {
      if (!t.id || !t.title || !lifecycles.includes(t.trigger) || !automations[t.automationId]) {
        return send(res, 400, { message: `invalid trigger ${JSON.stringify(t)}` });
      }
    }
    for (const [id, a] of Object.entries(automations)) {
      if (a.id !== id || !a.title || !['all', 'any'].includes(a.filterRule) || !Array.isArray(a.filters) || !Array.isArray(a.outputs)) {
        return send(res, 400, { message: `invalid automation ${id}` });
      }
      for (const o of a.outputs) {
        if (o.type === 'ontime' && /-set$/.test(o.action) && /^aux/.test(o.action) && typeof o.time !== 'string') {
          return send(res, 400, { message: `automation ${id}: ${o.action} requires a time string` });
        }
      }
    }
    state.automation = {
      enabledAutomations: body.enabledAutomations,
      enabledOscIn: body.enabledOscIn,
      oscPortIn: body.oscPortIn,
      triggers,
      automations,
    };
    return send(res, 200, state.automation);
  }

  if (req.method === 'POST' && path === '/data/rundowns/import') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return send(res, 400, { message: 'Invalid JSON body' });
    }
    const { mode, targetRundownId, rundown, customFields } = body;
    if (!['override', 'merge', 'new'].includes(mode)) {
      return send(res, 400, { message: 'mode must be one of override, merge, new' });
    }
    if (!rundown || typeof rundown !== 'object' || !rundown.entries || !Array.isArray(rundown.order)) {
      return send(res, 400, { message: 'rundown.entries object and rundown.order array are required' });
    }
    if (!customFields || typeof customFields !== 'object') {
      return send(res, 400, { message: 'customFields object is required' });
    }
    // Ontime's custom-field key rule
    for (const [key, field] of Object.entries(customFields)) {
      const expected = String(field.label ?? '').trim().replaceAll(' ', '_');
      if (key !== expected) {
        return send(res, 400, {
          message: `custom field key "${key}" must equal label with underscores ("${expected}")`,
        });
      }
    }
    if (mode === 'new') {
      const id = `imported-${Date.now()}`;
      state.rundowns[id] = {
        id,
        title: rundown.title ?? 'Imported rundown',
        order: rundown.order,
        flatOrder: rundown.flatOrder ?? rundown.order,
        entries: rundown.entries,
        revision: 0,
      };
      state.loaded = id;
      state.customFields = { ...state.customFields, ...customFields };
      return send(res, 200, rundownList());
    }
    if (!targetRundownId) {
      return send(res, 400, { message: 'targetRundownId is required when mode is override or merge' });
    }
    const target = state.rundowns[targetRundownId];
    if (!target) return send(res, 400, { message: `rundown ${targetRundownId} not found` });

    if (mode === 'override') {
      target.entries = rundown.entries;
      target.order = rundown.order;
      target.flatOrder = rundown.flatOrder ?? rundown.order;
    } else {
      target.entries = { ...target.entries, ...rundown.entries };
      const merged = [...target.order];
      for (const id of rundown.order) if (!merged.includes(id)) merged.push(id);
      target.order = merged;
      target.flatOrder = [...merged];
    }
    target.revision += 1;
    state.customFields = { ...state.customFields, ...customFields };
    return send(res, 200, rundownList());
  }

  // Reset helper for tests
  if (req.method === 'POST' && path === '/__reset') {
    state.loaded = 'default';
    state.rundowns = { default: seedRundown() };
    return send(res, 200, { ok: true });
  }

  send(res, 404, { message: `Not found: ${req.method} ${path}` });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[mock-ontime] listening on http://localhost:${PORT}${TOKEN ? ' (token required)' : ''}`);
});
