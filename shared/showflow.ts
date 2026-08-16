/**
 * Show Flow Sync — sheet parsing + Ontime v4 rundown conversion.
 *
 * Rules implemented here come from:
 *  - showflow-master-reference.md      (colours, timer types, screen states, content conventions)
 *  - ontime-json-master-reference.md   (project JSON structure, custom-field underscore key rule)
 *  - pet_valu_franchise_session_1_ontime_project.json (exemplar entry / customFields shapes)
 *
 * This module is pure (no node/browser APIs) so both server and client can use it.
 */

/* ------------------------------------------------------------------ colours */

export const COLOUR_HEX = {
  yellow: '#FFCC78',
  green: '#77C785',
  purple: '#A790F5',
  blue: '#779BE7',
} as const;

export type ColourName = keyof typeof COLOUR_HEX;

export const COLOUR_MEANING: Record<ColourName, string> = {
  yellow: 'Video',
  green: 'Break / walk-in',
  purple: 'Intro / outro',
  blue: 'Segment',
};

/** Reverse lookup: hex (upper) -> colour name */
export const HEX_TO_COLOUR: Record<string, ColourName> = Object.entries(COLOUR_HEX).reduce(
  (acc, [name, hex]) => {
    acc[hex.toUpperCase()] = name as ColourName;
    return acc;
  },
  {} as Record<string, ColourName>,
);

/* ------------------------------------------------------- custom field decls */

export interface OntimeCustomField {
  type: 'text';
  colour: string;
  label: string;
}

/**
 * Custom fields for the 13-column technical show flow.
 * Key MUST equal label.trim().replaceAll(' ', '_') — Ontime silently drops the
 * field otherwise (customFields.parser.ts).
 */
const CUSTOM_FIELD_LABELS: Array<{ label: string; colour: string }> = [
  { label: 'Screenstate', colour: '#9E9E9E' },
  { label: 'Video', colour: '#FFCC78' },
  { label: 'Lighting', colour: '#A790F5' },
  { label: 'Audio', colour: '#339E4E' },
  { label: 'Speakers', colour: '#3E75E8' },
  { label: 'Stage', colour: '#ED3333' },
];

export const customFieldKey = (label: string) => label.trim().replaceAll(' ', '_');

export interface CustomColumn {
  label: string;
  colour: string;
}

const DEFAULT_CUSTOM_COLOUR = '#9E9E9E';

export function buildCustomFields(
  columns: CustomColumn[] = CUSTOM_FIELD_LABELS,
): Record<string, OntimeCustomField> {
  const out: Record<string, OntimeCustomField> = {};
  for (const { label, colour } of columns) {
    out[customFieldKey(label)] = { type: 'text', colour, label };
  }
  return out;
}

export const CUSTOM_FIELD_ORDER = CUSTOM_FIELD_LABELS.map((f) => customFieldKey(f.label));

/* --------------------------------------------------------------- CSV parser */

/** RFC4180-ish CSV parser: handles quoted fields containing commas + newlines. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const text = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/* ------------------------------------------------------------- time helpers */

export const MS_PER_DAY = 86_400_000;

/** "1:00:00" | "30:00" | "00:10" | "90s" | "5" -> milliseconds */
export function parseDuration(raw: string): number | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const compact = value.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/i);
  if (compact && (compact[1] || compact[2] || compact[3])) {
    const h = Number(compact[1] ?? 0);
    const m = Number(compact[2] ?? 0);
    const s = Number(compact[3] ?? 0);
    return ((h * 60 + m) * 60 + s) * 1000;
  }
  const parts = value.split(':');
  if (parts.some((p) => p.trim() === '' || !/^\d+(\.\d+)?$/.test(p.trim()))) return null;
  const nums = parts.map((p) => Number(p.trim()));
  if (nums.length === 3) return ((nums[0] * 60 + nums[1]) * 60 + nums[2]) * 1000;
  if (nums.length === 2) return (nums[0] * 60 + nums[1]) * 1000; // mm:ss
  if (nums.length === 1) return nums[0] * 60_000; // bare number = minutes
  return null;
}

/** "8:00 PM" | "5:30:00 PM" | "20:00" | "20:00:30" -> ms from midnight */
export function parseClockTime(raw: string): number | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const m = value.match(/^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const sec = Number(m[3] ?? 0);
  const mer = m[4]?.toLowerCase();
  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer === 'pm' && h !== 12) h += 12;
    if (mer === 'am' && h === 12) h = 0;
  }
  if (h > 23 || min > 59 || sec > 59) return null;
  return ((h * 60 + min) * 60 + sec) * 1000;
}

export function formatMsClock(ms: number, use12h = true): string {
  const total = ((ms % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
  const h24 = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (!use12h) return `${pad(h24)}:${pad(m)}:${pad(s)}`;
  const mer = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad(m)}:${pad(s)} ${mer}`;
}

export function formatMsDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/* ------------------------------------------------------------------- parser */

export interface ParseWarning {
  row: number; // 1-based sheet row number
  cue: string;
  field: string;
  message: string;
}

export interface ShowFlowRow {
  rowNumber: number;
  cue: string;
  startTimeRaw: string;
  endTimeRaw: string;
  linkStartRaw: string;
  title: string;
  durationRaw: string;
  timerTypeRaw: string;
  /** Raw "Aux Timer" cell ("none", blank, or a duration). */
  auxTimerRaw: string;
  /** Parsed aux timer duration in ms, or null when the row does not (re)set the aux timer. */
  auxTimerMs: number | null;
  colourRaw: string;
  colour: ColourName | null;
  colourHex: string;
  timerType: 'count-down' | 'none';
  durationMs: number;
  timeStart: number; // ms from midnight
  timeEnd: number;
  dayOffset: number;
  linkStart: boolean;
  note: string;
  custom: Record<string, string>;
}

export interface ParsedShowFlow {
  rows: ShowFlowRow[];
  warnings: ParseWarning[];
  headerRow: number;
  columnsFound: string[];
  /** Every non-mandatory column, in sheet order — each becomes an Ontime custom field. */
  customColumns: CustomColumn[];
}

const EXPECTED_HEADERS = [
  'Cue #',
  'Start Time',
  'Title',
  'Duration',
  'End Time',
  'Linkstart',
  'Timer Type',
  'Aux Timer',
  'Colour',
  'Screenstate',
  'Video',
  'Lighting',
  'Audio',
  'Speakers',
  'Stage',
  'Notes',
];

const norm = (s: string) => (s ?? '').trim().toLowerCase().replace(/[\s#_-]+/g, '');

/** Alternate header spellings we accept for the mandatory columns. */
const HEADER_ALIASES: Record<string, string[]> = {
  Colour: ['color', 'itemcolour', 'itemcolor'],
  Linkstart: ['linkstarttrueifthisitemsstarttimelinkstothepreviousitemfalseifnot', 'link'],
  'Aux Timer': ['aux', 'aux1', 'auxduration', 'auxtimerduration', 'auxtimer1'],
};
const headerMatches = (h: string, expected: string) =>
  norm(h) === norm(expected) || (HEADER_ALIASES[expected] ?? []).includes(norm(h));

/** NEVER emit the word "keynote" (Apple software confusion) — these shows use PPT. */
export function stripKeynote(text: string): { value: string; changed: boolean } {
  if (!/keynote/i.test(text)) return { value: text, changed: false };
  return { value: text.replace(/keynotes?/gi, 'PPT'), changed: true };
}

export function parseShowFlowCsv(csv: string): ParsedShowFlow {
  const warnings: ParseWarning[] = [];
  const table = parseCsv(csv);

  // Locate the header row — real sheets often carry a title/banner row above it.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(table.length, 20); i++) {
    const r = table[i] ?? [];
    if (r.some((c) => norm(c) === 'cue') && r.some((c) => norm(c) === 'title')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error(
      'Could not find the show flow header row. Expected a row containing "Cue #", "Start Time", "Title", "Duration", "Timer Type", "Colour", ... — check the tab name.',
    );
  }
  if (headerIdx > 0) {
    warnings.push({
      row: headerIdx + 1,
      cue: '',
      field: 'header',
      message: `Header found on sheet row ${headerIdx + 1} (${headerIdx} banner row${headerIdx > 1 ? 's' : ''} skipped above it).`,
    });
  }

  const header = (table[headerIdx] ?? []).map((c) => c.trim());
  const MANDATORY_HEADERS = ['Cue #', 'Start Time', 'Duration', 'End Time', 'Linkstart', 'Title', 'Timer Type', 'Colour'];
  // Timer Type is optional: when the column is absent the timer type is derived from the
  // row colour (blue → count-down) without warnings. Aux Timer is optional by nature.
  const OPTIONAL_HEADERS = new Set(['End Time', 'Linkstart', 'Timer Type']);
  const index: Record<string, number> = {};
  EXPECTED_HEADERS.forEach((expected) => {
    const at = header.findIndex((h) => headerMatches(h, expected));
    index[expected] = at;
    if (at === -1 && MANDATORY_HEADERS.includes(expected) && !OPTIONAL_HEADERS.has(expected)) {
      warnings.push({
        row: headerIdx + 1,
        cue: '',
        field: expected,
        message: `Column "${expected}" not found in the sheet header — values will be blank.`,
      });
    }
  });

  // Every other named column becomes an Ontime custom field (known ones keep their colour).
  const reservedNames = [...MANDATORY_HEADERS, 'Notes', 'Aux Timer'];
  const isReserved = (label: string) => reservedNames.some((r) => headerMatches(label, r));
  const knownColour = new Map(CUSTOM_FIELD_LABELS.map((f) => [norm(f.label), f.colour]));
  const customColumns: Array<CustomColumn & { at: number }> = [];
  const seenKeys = new Set<string>();
  header.forEach((label, at) => {
    if (!label || isReserved(label)) return;
    const key = customFieldKey(label);
    if (!key || seenKeys.has(key)) return;
    seenKeys.add(key);
    customColumns.push({ label, colour: knownColour.get(norm(label)) ?? DEFAULT_CUSTOM_COLOUR, at });
  });

  const cell = (r: string[], name: string) => {
    const at = index[name];
    return at === -1 || at === undefined ? '' : (r[at] ?? '').trim();
  };

  const hasTimerTypeColumn = index['Timer Type'] !== -1;

  const rows: ShowFlowRow[] = [];
  const seenCues = new Map<string, number>();
  let prevEndAbsolute: number | null = null;
  let dayCarry = 0;

  for (let i = headerIdx + 1; i < table.length; i++) {
    const raw = table[i] ?? [];
    if (!raw.some((c) => (c ?? '').trim() !== '')) continue; // blank row
    const rowNumber = i + 1;

    const cue = cell(raw, 'Cue #');
    const titleRaw = cell(raw, 'Title');
    if (!cue && !titleRaw) continue;

    if (cue) {
      if (seenCues.has(cue)) {
        warnings.push({
          row: rowNumber,
          cue,
          field: 'Cue #',
          message: `Duplicate cue number "${cue}" (also on sheet row ${seenCues.get(cue)}).`,
        });
      } else {
        seenCues.set(cue, rowNumber);
      }
    } else {
      warnings.push({ row: rowNumber, cue: '', field: 'Cue #', message: 'Missing cue number.' });
    }

    // ---- colour
    const colourRaw = cell(raw, 'Colour');
    const colourKey = colourRaw.trim().toLowerCase();
    let colour: ColourName | null = null;
    if (colourKey in COLOUR_HEX) {
      colour = colourKey as ColourName;
    } else if (HEX_TO_COLOUR[colourRaw.trim().toUpperCase()]) {
      colour = HEX_TO_COLOUR[colourRaw.trim().toUpperCase()];
    } else if (colourRaw) {
      warnings.push({
        row: rowNumber,
        cue,
        field: 'Colour',
        message: `Unknown colour "${colourRaw}" — expected Yellow / Green / Purple / Blue. Row left uncoloured.`,
      });
    } else {
      warnings.push({ row: rowNumber, cue, field: 'Colour', message: 'Missing colour.' });
    }

    // ---- timer type (trust the column, fall back to colour)
    const timerTypeRaw = cell(raw, 'Timer Type');
    const timerNorm = timerTypeRaw.trim().toLowerCase().replace(/\s+/g, '-');
    let timerType: 'count-down' | 'none';
    if (timerNorm === 'count-down' || timerNorm === 'countdown') {
      timerType = 'count-down';
    } else if (timerNorm === 'none') {
      timerType = 'none';
    } else {
      timerType = colour === 'blue' ? 'count-down' : 'none';
      if (timerTypeRaw) {
        warnings.push({
          row: rowNumber,
          cue,
          field: 'Timer Type',
          message: `Unsupported timer type "${timerTypeRaw}" — fell back to "${timerType}" from the row colour.`,
        });
      } else if (hasTimerTypeColumn) {
        warnings.push({
          row: rowNumber,
          cue,
          field: 'Timer Type',
          message: `Blank timer type — defaulted to "${timerType}" from the row colour.`,
        });
      }
    }

    // ---- aux timer ("none"/blank = no action; a duration = reset & restart Aux 1 on this cue)
    const auxTimerRaw = cell(raw, 'Aux Timer');
    const auxNorm = auxTimerRaw.trim().toLowerCase();
    let auxTimerMs: number | null = null;
    if (auxTimerRaw && !['none', 'no', 'off', '-', '—'].includes(auxNorm)) {
      auxTimerMs = parseDuration(auxTimerRaw);
      if (auxTimerMs === null || auxTimerMs === 0) {
        if (auxTimerMs === null) {
          warnings.push({
            row: rowNumber,
            cue,
            field: 'Aux Timer',
            message: `Could not read aux timer "${auxTimerRaw}" — expected a duration like 00:40:00 or "none". No aux automation for this cue.`,
          });
        }
        auxTimerMs = null;
      } else if (!cue) {
        warnings.push({
          row: rowNumber,
          cue,
          field: 'Aux Timer',
          message: `Aux timer ${auxTimerRaw} needs a cue number to build its automation — row skipped.`,
        });
        auxTimerMs = null;
      } else if (auxTimerMs < 60_000) {
        warnings.push({
          row: rowNumber,
          cue,
          field: 'Aux Timer',
          message: `Aux timer "${auxTimerRaw}" is under a minute (${Math.round(auxTimerMs / 1000)}s) — double-check it isn't meant to be minutes (e.g. 00:06:00).`,
        });
      }
    }

    // ---- start / end / linkstart raw values
    const startTimeRaw = cell(raw, 'Start Time');
    const endTimeRaw = cell(raw, 'End Time');
    const linkStartRaw = cell(raw, 'Linkstart');
    const startOfDay = parseClockTime(startTimeRaw);
    const endOfDay = parseClockTime(endTimeRaw);
    if (endTimeRaw && endOfDay === null) {
      warnings.push({
        row: rowNumber,
        cue,
        field: 'End Time',
        message: `Could not read end time "${endTimeRaw}" — ignored.`,
      });
    }

    // ---- duration (explicit column, or derived from Start + End on clock-pinned rows)
    const durationRaw = cell(raw, 'Duration');
    let durationMs = parseDuration(durationRaw);
    if (durationMs === null) {
      if (durationRaw) {
        warnings.push({
          row: rowNumber,
          cue,
          field: 'Duration',
          message: `Could not read duration "${durationRaw}" — treated as 00:00.`,
        });
        durationMs = 0;
      } else if (startOfDay !== null && endOfDay !== null) {
        durationMs = endOfDay - startOfDay;
        if (durationMs < 0) durationMs += MS_PER_DAY; // end rolls past midnight
      } else {
        warnings.push({
          row: rowNumber,
          cue,
          field: 'Duration',
          message: 'Blank duration — treated as 00:00 (momentary cue).',
        });
        durationMs = 0;
      }
    } else if (startOfDay !== null && endOfDay !== null) {
      let derived = endOfDay - startOfDay;
      if (derived < 0) derived += MS_PER_DAY;
      if (derived !== durationMs) {
        warnings.push({
          row: rowNumber,
          cue,
          field: 'Duration',
          message: `Duration ${durationRaw} disagrees with Start/End times (${formatMsDuration(derived)}) — the Duration column wins.`,
        });
      }
    }

    // ---- start time (absolute timeline, rolling past midnight)
    let absoluteStart: number;
    let pinned = false;

    if (startOfDay === null) {
      if (startTimeRaw) {
        warnings.push({
          row: rowNumber,
          cue,
          field: 'Start Time',
          message: `Could not read start time "${startTimeRaw}" — chained from the previous cue instead.`,
        });
      }
      absoluteStart = prevEndAbsolute ?? 0;
    } else {
      pinned = true;
      absoluteStart = startOfDay + dayCarry * MS_PER_DAY;
      // roll past midnight: a start earlier than the previous row means next day
      while (prevEndAbsolute !== null && absoluteStart < prevEndAbsolute - 1000) {
        dayCarry += 1;
        absoluteStart += MS_PER_DAY;
        warnings.push({
          row: rowNumber,
          cue,
          field: 'Start Time',
          message: `Start time ${startTimeRaw} is earlier than the previous cue — rolled past midnight (dayOffset ${dayCarry}).`,
        });
      }
    }

    // ---- linkstart (explicit column wins; otherwise inferred from times)
    const linkNorm = linkStartRaw.trim().toLowerCase();
    let explicitLink: boolean | null = null;
    if (linkNorm === 'true' || linkNorm === 'yes') explicitLink = true;
    else if (linkNorm === 'false' || linkNorm === 'no') explicitLink = false;
    else if (linkStartRaw) {
      warnings.push({
        row: rowNumber,
        cue,
        field: 'Linkstart',
        message: `Could not read Linkstart "${linkStartRaw}" — expected TRUE or FALSE; inferred from times instead.`,
      });
    }

    let linkStart: boolean;
    if (explicitLink !== null && rows.length > 0) {
      linkStart = explicitLink;
      if (explicitLink) {
        if (pinned && prevEndAbsolute !== null && absoluteStart !== prevEndAbsolute) {
          warnings.push({
            row: rowNumber,
            cue,
            field: 'Linkstart',
            message: `Linkstart is TRUE, so the cue chains from the previous cue's end — the sheet start time ${startTimeRaw} is ignored.`,
          });
        }
        if (prevEndAbsolute !== null) absoluteStart = prevEndAbsolute;
      } else if (startOfDay === null) {
        warnings.push({
          row: rowNumber,
          cue,
          field: 'Linkstart',
          message: `Linkstart is FALSE but the row has no Start Time — using the previous cue's end as the start.`,
        });
      }
    } else {
      linkStart =
        rows.length > 0 &&
        (!pinned || prevEndAbsolute === null || absoluteStart === prevEndAbsolute);
      if (
        rows.length > 0 &&
        pinned &&
        prevEndAbsolute !== null &&
        absoluteStart !== prevEndAbsolute
      ) {
        const deltaS = Math.round((absoluteStart - prevEndAbsolute) / 1000);
        warnings.push({
          row: rowNumber,
          cue,
          field: 'Start Time',
          message: `Clock-pinned row: sheet start is ${deltaS > 0 ? `${deltaS}s after` : `${Math.abs(deltaS)}s before`} the previous cue's end, so linkStart is false to preserve the sheet time.`,
        });
      }
    }

    const absoluteEnd: number = absoluteStart + durationMs;

    // ---- custom fields (only non-empty)
    const custom: Record<string, string> = {};
    for (const { label, at } of customColumns) {
      const value = (raw[at] ?? '').trim();
      if (!value) continue;
      const cleaned = stripKeynote(value);
      if (cleaned.changed) {
        warnings.push({
          row: rowNumber,
          cue,
          field: label,
          message: 'The word "keynote" was replaced with "PPT" (these shows use PowerPoint).',
        });
      }
      custom[customFieldKey(label)] = cleaned.value;
    }

    // ---- title / note
    const titleClean = stripKeynote(titleRaw);
    if (titleClean.changed) {
      warnings.push({
        row: rowNumber,
        cue,
        field: 'Title',
        message: 'The word "keynote" was replaced with "PPT" in the title.',
      });
    }
    const noteClean = stripKeynote(cell(raw, 'Notes'));
    if (noteClean.changed) {
      warnings.push({
        row: rowNumber,
        cue,
        field: 'Notes',
        message: 'The word "keynote" was replaced with "PPT" in the note.',
      });
    }

    rows.push({
      rowNumber,
      cue,
      startTimeRaw,
      endTimeRaw,
      linkStartRaw,
      title: titleClean.value,
      durationRaw,
      timerTypeRaw,
      auxTimerRaw,
      auxTimerMs,
      colourRaw,
      colour,
      colourHex: colour ? COLOUR_HEX[colour] : '',
      timerType,
      durationMs,
      timeStart: ((absoluteStart % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY,
      timeEnd: ((absoluteEnd % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY,
      dayOffset: Math.floor(absoluteStart / MS_PER_DAY),
      linkStart,
      note: noteClean.value,
      custom,
    });

    prevEndAbsolute = absoluteEnd;
  }

  if (rows.length === 0) {
    throw new Error('The sheet header was found but no cue rows followed it.');
  }

  return {
    rows,
    warnings,
    headerRow: headerIdx + 1,
    columnsFound: header.filter(Boolean),
    customColumns: customColumns.map(({ label, colour }) => ({ label, colour })),
  };
}

/* --------------------------------------------------------------- conversion */

export interface OntimeEntry {
  id: string;
  type: 'event';
  flag: boolean;
  title: string;
  timeStart: number;
  timeEnd: number;
  duration: number;
  timeStrategy: 'lock-duration';
  linkStart: boolean;
  endAction: 'none';
  timerType: 'count-down' | 'none';
  countToEnd: boolean;
  skip: boolean;
  note: string;
  colour: string;
  delay: number;
  dayOffset: number;
  gap: number;
  cue: string;
  parent: null;
  revision: number;
  timeWarning: number;
  timeDanger: number;
  custom: Record<string, string>;
  triggers: unknown[];
}

export interface NormalisedRundown {
  id: string;
  title: string;
  order: string[];
  flatOrder: string[];
  entries: Record<string, OntimeEntry>;
  revision: number;
}

export interface OntimeProjectFile {
  rundowns: Record<string, NormalisedRundown>;
  project: {
    title: string;
    description: string;
    url: string;
    info: string;
    logo: null;
    custom: unknown[];
  };
  settings: {
    version: string;
    editorKey: null;
    operatorKey: null;
    timeFormat: '12';
    language: 'en';
  };
  viewSettings: {
    dangerColor: string;
    normalColor: string;
    overrideStyles: boolean;
    warningColor: string;
  };
  urlPresets: unknown[];
  customFields: Record<string, OntimeCustomField>;
  automation: {
    enabledAutomations: boolean;
    enabledOscIn: boolean;
    oscPortIn: number;
    triggers: unknown[];
    automations: Record<string, unknown>;
  };
}

/** Stable 8-char id: "cl" + 6 hex, deterministic from the cue (so overrides don't churn ids). */
export function entryId(seed: string, salt = ''): string {
  const input = `${salt}::${seed}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    h1 ^= input.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (Math.imul(h2 ^ input.charCodeAt(i), 0x85ebca6b) + i) >>> 0;
  }
  const hex = ((h1 ^ h2) >>> 0).toString(16).padStart(8, '0').slice(-6);
  return `cl${hex}`;
}

/* ------------------------------------------------------- aux automations */

/**
 * Automations generated from the "Aux Timer" column. Every generated title starts
 * with this prefix so a later sync can find and replace ONLY its own automations,
 * leaving anything the operator built by hand in Ontime untouched.
 */
export const AUX_AUTOMATION_PREFIX = 'Mosc-sync aux:';

export interface OntimeAutomationFilter {
  field: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'not_contains';
  value: string;
}

export interface OntimeAutomationOutput {
  type: 'ontime';
  action: string;
  time?: string;
}

export interface OntimeAutomation {
  id: string;
  title: string;
  filterRule: 'all' | 'any';
  filters: OntimeAutomationFilter[];
  outputs: OntimeAutomationOutput[];
}

export interface OntimeTrigger {
  id: string;
  title: string;
  trigger: 'onLoad' | 'onStart' | 'onPause' | 'onStop' | 'onClock' | 'onUpdate' | 'onFinish' | 'onWarning' | 'onDanger';
  automationId: string;
}

export interface AuxAutomationBundle {
  automations: Record<string, OntimeAutomation>;
  triggers: OntimeTrigger[];
  /** One entry per cue that (re)sets the aux timer — for UI display. */
  cues: Array<{ cue: string; title: string; time: string }>;
}

/** Always emit three-section HH:MM:SS — Ontime's parseUserTime reads a two-section
 *  value like "40:00" as 40 HOURS ([hours][minutes]), so short forms are unsafe. */
export function formatAuxTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/**
 * Builds Ontime automations from the Aux Timer column:
 *  - per cue with a duration: an onStart trigger filtered to that cue number that
 *    stops → sets → starts Aux 1 (stop first: SimpleTimer.setTime does not clear the
 *    elapsed time of a running timer, so a bare set on a running aux under-counts);
 *  - one global onStop trigger that stops Aux 1 when playback stops (end of show).
 * Aux timers count DOWN by default in Ontime, which is the behaviour these shows use.
 */
export function buildAuxAutomations(rows: ShowFlowRow[], showName = ''): AuxAutomationBundle {
  const automations: Record<string, OntimeAutomation> = {};
  const triggers: OntimeTrigger[] = [];
  const cues: AuxAutomationBundle['cues'] = [];

  const auxRows = rows.filter((r) => r.auxTimerMs !== null && r.auxTimerMs > 0 && r.cue);

  for (const row of auxRows) {
    const time = formatAuxTime(row.auxTimerMs as number);
    const id = entryId(`aux:${row.cue}`, `${showName}::aux`);
    const title = `${AUX_AUTOMATION_PREFIX} cue ${row.cue} → ${time}`;
    automations[id] = {
      id,
      title,
      filterRule: 'all',
      filters: [{ field: 'eventNow.cue', operator: 'equals', value: row.cue }],
      outputs: [
        { type: 'ontime', action: 'aux1-stop' },
        { type: 'ontime', action: 'aux1-set', time },
        { type: 'ontime', action: 'aux1-start' },
      ],
    };
    triggers.push({
      id: entryId(`auxtrig:${row.cue}`, `${showName}::aux`),
      title,
      trigger: 'onStart',
      automationId: id,
    });
    cues.push({ cue: row.cue, title: row.title, time });
  }

  if (auxRows.length > 0) {
    const stopId = entryId('aux:show-stop', `${showName}::aux`);
    const stopTitle = `${AUX_AUTOMATION_PREFIX} stop aux with show`;
    automations[stopId] = {
      id: stopId,
      title: stopTitle,
      filterRule: 'all',
      filters: [],
      outputs: [{ type: 'ontime', action: 'aux1-stop' }],
    };
    triggers.push({
      id: entryId('auxtrig:show-stop', `${showName}::aux`),
      title: stopTitle,
      trigger: 'onStop',
      automationId: stopId,
    });
  }

  return { automations, triggers, cues };
}

export interface ConvertOptions {
  showName: string;
  sheetUrl: string;
  rundownId?: string;
  ontimeVersion?: string;
}

export interface ConversionResult {
  rundown: NormalisedRundown;
  customFields: Record<string, OntimeCustomField>;
  customFieldOrder: string[];
  projectFile: OntimeProjectFile;
  auxAutomations: AuxAutomationBundle;
}

export function convertToOntime(parsed: ParsedShowFlow, options: ConvertOptions): ConversionResult {
  const rundownId = options.rundownId ?? 'default';
  const entries: Record<string, OntimeEntry> = {};
  const order: string[] = [];

  parsed.rows.forEach((row, i) => {
    let id = entryId(row.cue || `row-${row.rowNumber}`, options.showName);
    let attempt = 1;
    while (entries[id]) {
      id = entryId(`${row.cue || `row-${row.rowNumber}`}#${attempt}`, options.showName);
      attempt++;
    }
    entries[id] = {
      id,
      type: 'event',
      flag: false,
      title: row.title,
      timeStart: row.timeStart,
      timeEnd: row.timeEnd,
      duration: row.durationMs,
      timeStrategy: 'lock-duration',
      linkStart: i === 0 ? false : row.linkStart,
      endAction: 'none',
      timerType: row.timerType,
      countToEnd: false,
      skip: false,
      note: row.note,
      colour: row.colourHex,
      delay: 0,
      dayOffset: row.dayOffset,
      gap: 0,
      cue: row.cue,
      parent: null,
      revision: 0,
      timeWarning: 120000,
      timeDanger: 60000,
      custom: row.custom,
      triggers: [],
    };
    order.push(id);
  });

  const rundown: NormalisedRundown = {
    id: rundownId,
    title: options.showName,
    order,
    flatOrder: [...order],
    entries,
    revision: 0,
  };

  const customFields = buildCustomFields(parsed.customColumns);
  const customFieldOrder = parsed.customColumns.map((c) => customFieldKey(c.label));
  const auxAutomations = buildAuxAutomations(parsed.rows, options.showName);
  const hasAux = Object.keys(auxAutomations.automations).length > 0;

  const projectFile: OntimeProjectFile = {
    rundowns: { [rundownId]: rundown },
    project: {
      title: options.showName,
      description: 'Showflow converted from Google Sheet for Ontime import',
      url: options.sheetUrl,
      info: 'Scan this QR Code to access the Production Playbook',
      logo: null,
      custom: [],
    },
    settings: {
      version: options.ontimeVersion ?? '4.7.0',
      editorKey: null,
      operatorKey: null,
      timeFormat: '12',
      language: 'en',
    },
    viewSettings: {
      dangerColor: '#ff7300',
      normalColor: '#ffffffcc',
      overrideStyles: false,
      warningColor: '#ffa528',
    },
    urlPresets: [],
    customFields,
    automation: {
      enabledAutomations: hasAux,
      enabledOscIn: false,
      oscPortIn: 8888,
      triggers: auxAutomations.triggers,
      automations: auxAutomations.automations,
    },
  };

  return { rundown, customFields, customFieldOrder, projectFile, auxAutomations };
}

/** Validation mirroring the master reference checklist. */
export function validateRundown(rundown: NormalisedRundown): string[] {
  const problems: string[] = [];
  const keys = Object.keys(rundown.entries);
  if (keys.length !== rundown.order.length) problems.push('entries and order have different lengths');
  if (rundown.order.join('|') !== rundown.flatOrder.join('|')) problems.push('order !== flatOrder');
  for (const id of rundown.order) {
    const e = rundown.entries[id];
    if (!e) {
      problems.push(`order references missing entry ${id}`);
      continue;
    }
    if (e.id !== id) problems.push(`entry key ${id} !== id ${e.id}`);
    const span = (e.timeEnd - e.timeStart + MS_PER_DAY) % MS_PER_DAY;
    if (span !== e.duration % MS_PER_DAY) {
      problems.push(`cue ${e.cue || e.title}: duration !== timeEnd - timeStart`);
    }
    if (e.colour && !HEX_TO_COLOUR[e.colour.toUpperCase()]) {
      problems.push(`cue ${e.cue || e.title}: colour ${e.colour} is not one of the four show colours`);
    }
    if (/keynote/i.test(JSON.stringify(e))) problems.push(`cue ${e.cue}: contains the word "keynote"`);
  }
  return problems;
}

/* --------------------------------------------------------------------- diff */

export type DiffFieldChange = {
  field: string;
  from: string;
  to: string;
};

export interface DiffCueRow {
  cue: string;
  title: string;
  colour: string;
  changes?: DiffFieldChange[];
}

export interface RundownDiff {
  added: DiffCueRow[];
  removed: DiffCueRow[];
  changed: DiffCueRow[];
  unchanged: number;
  reorderedFrom?: string[];
  reorderedTo?: string[];
  isReordered: boolean;
  extraTargetCustomFields: string[];
}

type RemoteEntry = Partial<OntimeEntry> & { type?: string };

const cueKeyOf = (e: RemoteEntry, i: number) => (e.cue && String(e.cue).trim()) || `#row-${i + 1}`;

export function diffRundowns(
  generated: NormalisedRundown,
  generatedCustomFields: Record<string, OntimeCustomField>,
  remote: { order?: string[]; entries?: Record<string, RemoteEntry> } | null,
  remoteCustomFields: Record<string, unknown> | null,
): RundownDiff {
  const localOrder = generated.order.map((id) => generated.entries[id]);
  const remoteOrder = (remote?.order ?? [])
    .map((id) => remote?.entries?.[id])
    .filter((e): e is RemoteEntry => Boolean(e) && (e as RemoteEntry).type === 'event');

  const localByCue = new Map<string, OntimeEntry>();
  localOrder.forEach((e, i) => localByCue.set(cueKeyOf(e, i), e));
  const remoteByCue = new Map<string, RemoteEntry>();
  remoteOrder.forEach((e, i) => remoteByCue.set(cueKeyOf(e, i), e));

  const added: DiffCueRow[] = [];
  const removed: DiffCueRow[] = [];
  const changed: DiffCueRow[] = [];
  let unchanged = 0;

  for (const [cue, local] of Array.from(localByCue.entries())) {
    const rem = remoteByCue.get(cue);
    if (!rem) {
      added.push({ cue, title: local.title, colour: local.colour });
      continue;
    }
    const changes: DiffFieldChange[] = [];
    const cmp = (field: string, from: string, to: string) => {
      if (from !== to) changes.push({ field, from, to });
    };
    cmp('title', String(rem.title ?? ''), local.title);
    cmp('duration', formatMsDuration(Number(rem.duration ?? 0)), formatMsDuration(local.duration));
    cmp('timeStart', formatMsClock(Number(rem.timeStart ?? 0)), formatMsClock(local.timeStart));
    cmp('colour', String(rem.colour ?? '').toUpperCase(), local.colour.toUpperCase());
    cmp('timerType', String(rem.timerType ?? ''), local.timerType);
    cmp('note', String(rem.note ?? ''), local.note);
    cmp('linkStart', String(Boolean(rem.linkStart)), String(local.linkStart));
    const remCustom = (rem.custom ?? {}) as Record<string, string>;
    const customKeys = new Set([...Object.keys(remCustom), ...Object.keys(local.custom)]);
    for (const key of Array.from(customKeys).sort()) {
      cmp(`custom.${key}`, String(remCustom[key] ?? ''), String(local.custom[key] ?? ''));
    }
    if (changes.length) changed.push({ cue, title: local.title, colour: local.colour, changes });
    else unchanged++;
  }

  for (const [cue, rem] of Array.from(remoteByCue.entries())) {
    if (!localByCue.has(cue)) {
      removed.push({ cue, title: String(rem.title ?? ''), colour: String(rem.colour ?? '') });
    }
  }

  const localSeq = localOrder.map((e, i) => cueKeyOf(e, i));
  const remoteSeq = remoteOrder.map((e, i) => cueKeyOf(e, i));
  const sharedLocal = localSeq.filter((c) => remoteByCue.has(c));
  const sharedRemote = remoteSeq.filter((c) => localByCue.has(c));
  const isReordered = sharedLocal.join('|') !== sharedRemote.join('|');

  const extraTargetCustomFields = Object.keys(remoteCustomFields ?? {}).filter(
    (k) => !(k in generatedCustomFields),
  );

  const cueSort = (a: DiffCueRow, b: DiffCueRow) => {
    const na = Number(a.cue);
    const nb = Number(b.cue);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.cue.localeCompare(b.cue);
  };

  return {
    added: added.sort(cueSort),
    removed: removed.sort(cueSort),
    changed: changed.sort(cueSort),
    unchanged,
    isReordered,
    reorderedFrom: isReordered ? sharedRemote : undefined,
    reorderedTo: isReordered ? sharedLocal : undefined,
    extraTargetCustomFields,
  };
}

/* -------------------------------------------------- new rundown naming */

/** Base name for a rundown created with mode: 'new' — matches the Google Sheet tab name. */
export function rundownBaseTitle(tabName: string): string {
  const tab = (tabName ?? '').trim();
  return tab || 'Show flow';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns `base` if no rundown on the instance already uses it, otherwise the next
 * free version: "base v2", "base v3", ... (one above the highest existing version).
 */
export function versionedRundownTitle(base: string, existingTitles: readonly string[]): string {
  const wanted = base.trim();
  const pattern = new RegExp(`^${escapeRegExp(wanted)}(?:\\s+v(\\d+))?$`, 'i');
  let highest = 0;
  for (const raw of existingTitles) {
    const match = pattern.exec((raw ?? '').trim());
    if (!match) continue;
    highest = Math.max(highest, match[1] ? Number(match[1]) : 1);
  }
  return highest === 0 ? wanted : `${wanted} v${highest + 1}`;
}

/* ------------------------------------------------------------- sheet urls */

export function sheetCsvUrl(sheetId: string, tabName: string): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
}

export function sheetEditUrl(sheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/edit`;
}

/** Decode the small set of HTML entities Google emits in tab captions (names, &amp;, etc). */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/**
 * Extracts tab (worksheet) names from the raw HTML of a spreadsheet's /edit page.
 * Google renders each tab as `<div class="docs-sheet-tab-caption">Name</div>` in the
 * initial server-rendered markup (no JS execution needed), but this relies on Google's
 * internal editor markup rather than a documented API — if Google changes this class
 * name, tab listing will silently return an empty list until updated.
 */
export function extractSheetTabNames(html: string): string[] {
  const names: string[] = [];
  const pattern = /docs-sheet-tab-caption[^>]*>([^<]*)</g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const name = decodeHtmlEntities(match[1]).trim();
    if (name) names.push(name);
  }
  return names;
}
