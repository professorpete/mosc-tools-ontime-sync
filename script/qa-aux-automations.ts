/** Ad-hoc end-to-end check for aux-timer automations (not shipped). */
import { parseShowFlowCsv, convertToOntime, formatAuxTime } from '../shared/showflow';
import { syncAuxAutomations, getAutomationSettings } from '../server/ontime';

const csv = [
  'Cue #,Start Time,Duration,End Time,Linkstart,Title,Aux Timer,Colour,Screen State,Main,Flanks,Audio,Lighting,Speakers,Stage,Notes',
  '1,8:00:00 AM,0:30:00,8:30:00 AM,FALSE,Walk-in,none,Green,SS1,,,,,,,',
  '2,8:30:00 AM,0:05:00,8:35:00 AM,TRUE,Intro video,none,Yellow,SS2,,,,,,,',
  '3,8:35:00 AM,0:05:00,8:40:00 AM,TRUE,Welcome,none,Purple,SS3,,,,,,,',
  '4,8:40:00 AM,0:20:00,9:00:00 AM,TRUE,Opening remarks,1:00:00,Blue,SS4,,,,,,,',
  '15,10:00:00 AM,0:10:00,10:10:00 AM,TRUE,Breakouts,0:40:00,Blue,SS5,,,,,,,',
  '22,11:00:00 AM,0:06:00,11:06:00 AM,TRUE,Final push,0:06:00,Blue,SS6,,,,,,,',
  '23,11:06:00 AM,0:05:00,11:11:00 AM,TRUE,ELT Exit,00:00:00,Purple,SS7,,,,,,,',
  '24,11:11:00 AM,0:10:00,11:21:00 AM,TRUE,Session ends / walk-out,none,Green,SS8,,,,,,,',
].join('\n');

const assert = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok - ${msg}`);
};

const parsed = parseShowFlowCsv(csv);
assert(parsed.rows.length === 8, 'parsed 8 rows');
assert(!parsed.customColumns.some((c) => /aux/i.test(c.label)), 'Aux Timer is NOT a custom field');
assert(!parsed.warnings.some((w) => w.field === 'Timer Type'), 'no Timer Type warnings when column removed');
const r4 = parsed.rows.find((r) => r.cue === '4')!;
assert(r4.auxTimerMs === 3_600_000, 'cue 4 aux = 1h');
assert(r4.timerType === 'count-down', 'cue 4 (blue) timer type from colour');
assert(parsed.rows.find((r) => r.cue === '1')!.auxTimerMs === null, '"none" parses to null');
assert(parsed.rows.find((r) => r.cue === '23')!.auxTimerMs === 0, '00:00:00 parses to 0 (clear)');
assert(
  !parsed.warnings.some((w) => w.cue === '23' && w.field === 'Aux Timer'),
  'no under-a-minute warning for an explicit 00:00:00 clear',
);
assert(formatAuxTime(2_400_000) === '00:40:00', 'formatAuxTime emits 3-section HH:MM:SS');

const conv = convertToOntime(parsed, { showName: 'Franchise 1 Test', sheetUrl: 'http://x' });
const auto = conv.auxAutomations;
assert(Object.keys(auto.automations).length === 5, '4 cue automations + 1 stop automation');
assert(auto.triggers.length === 5, '5 triggers');
assert(auto.triggers.filter((t) => t.trigger === 'onStart').length === 4, '4 onStart triggers');
assert(auto.triggers.filter((t) => t.trigger === 'onStop').length === 1, '1 onStop trigger');
const aClear = Object.values(auto.automations).find((a) => a.title.includes('cue 23'))!;
assert(aClear.title.endsWith('clear'), 'clear automation titled … → clear');
assert(
  aClear.outputs.map((o) => o.action).join(',') === 'aux1-stop,aux1-set',
  'clear outputs stop→set only (no start — timer stays blank)',
);
assert(aClear.outputs[1].time === '00:00:00', 'clear sets 00:00:00');
assert(auto.cues.find((c) => c.cue === '23')!.time === 'clear', 'UI cue list shows "clear"');
const a4 = Object.values(auto.automations).find((a) => a.title.includes('cue 4'))!;
assert(a4.filters[0].field === 'eventNow.cue' && a4.filters[0].value === '4', 'cue 4 filter');
assert(
  a4.outputs.map((o) => o.action).join(',') === 'aux1-stop,aux1-set,aux1-start',
  'stop→set→start output order',
);
assert(a4.outputs[1].time === '01:00:00', 'cue 4 set time 01:00:00');
assert(conv.projectFile.automation.enabledAutomations === true, 'project file enables automations');

// idempotent ids across runs
const conv2 = convertToOntime(parsed, { showName: 'Franchise 1 Test', sheetUrl: 'http://x' });
assert(
  JSON.stringify(Object.keys(conv.auxAutomations.automations)) ===
    JSON.stringify(Object.keys(conv2.auxAutomations.automations)),
  'deterministic automation ids',
);

// ---- against the mock server
const BASE = 'http://127.0.0.1:4111';
const main = async () => {
  const r1 = await syncAuxAutomations(BASE, null, auto);
  assert(r1.written === 5 && r1.removedStale === 0, `first push writes 5, removes 0 (got ${JSON.stringify(r1)})`);
  const s1 = await getAutomationSettings(BASE, null);
  assert(Object.keys(s1.automations).length === 6, 'mock now has 5 ours + 1 manual');
  assert(Boolean(s1.automations['manualA1']), 'manual automation preserved');
  assert(s1.enabledOscIn === true && s1.oscPortIn === 8899, 'OSC-in settings preserved');
  assert(s1.enabledAutomations === true, 'automations enabled');

  const r2 = await syncAuxAutomations(BASE, null, auto);
  assert(r2.written === 5 && r2.removedStale === 5, `second push replaces stale (got ${JSON.stringify(r2)})`);
  const s2 = await getAutomationSettings(BASE, null);
  assert(Object.keys(s2.automations).length === 6, 'no duplicates after re-sync');
  assert(s2.triggers.length === 6, '6 triggers total (5 ours + manual)');

  // empty bundle: cleans ours, keeps manual
  const r3 = await syncAuxAutomations(BASE, null, { automations: {}, triggers: [], cues: [] });
  assert(r3.written === 0 && r3.removedStale === 5, 'empty sheet cleans up our automations');
  const s3 = await getAutomationSettings(BASE, null);
  assert(Object.keys(s3.automations).length === 1 && Boolean(s3.automations['manualA1']), 'only manual remains');
  assert(s3.triggers.length === 1 && s3.triggers[0].id === 'manual01', 'manual trigger preserved');

  // guard: wholesale settings POST with an automations record must be rejected (the
  // real Ontime validator runs the single-automation parser on the whole record).
  const guard = await fetch(`${BASE}/data/automations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      enabledAutomations: true,
      enabledOscIn: false,
      oscPortIn: 8888,
      automations: s3.automations,
    }),
  });
  assert(guard.status === 422, 'bulk automations push is rejected with 422 (use granular endpoints)');

  console.log('\nALL TESTS PASSED');
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
