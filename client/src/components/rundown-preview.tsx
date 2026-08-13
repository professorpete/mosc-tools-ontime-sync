import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  COLOUR_HEX,
  COLOUR_MEANING,
  formatMsClock,
  formatMsDuration,
  type ColourName,
  type ShowFlowRow,
} from '@shared/showflow';
import type { ShowFlowSnapshot } from '@/lib/api';

const colourLabel = (row: ShowFlowRow) =>
  row.colour ? `${row.colour[0].toUpperCase()}${row.colour.slice(1)} · ${COLOUR_MEANING[row.colour]}` : 'No colour';

function tint(hex: string, alpha: string) {
  return hex ? `${hex}${alpha}` : 'transparent';
}

function CustomChips({ row, order }: { row: ShowFlowRow; order: string[] }) {
  const entries = order.filter((key) => row.custom[key]);
  if (!entries.length) return <span className="text-muted-foreground/50">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map((key) => (
        <span
          key={key}
          title={`${key.replaceAll('_', ' ')}: ${row.custom[key]}`}
          className="inline-flex max-w-[15rem] items-center gap-1 rounded-sm border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[11px] leading-tight"
          data-testid={`chip-${key}-${row.cue}`}
        >
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {key.replaceAll('_', ' ')}
          </span>
          <span className="truncate">{row.custom[key].split('\n')[0]}</span>
        </span>
      ))}
    </div>
  );
}

export function ColourLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {(Object.keys(COLOUR_HEX) as ColourName[]).map((name) => (
        <span key={name} className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: COLOUR_HEX[name] }}
            aria-hidden
          />
          <span className="capitalize">{name}</span>
          <span className="text-muted-foreground/60">{COLOUR_MEANING[name]}</span>
        </span>
      ))}
    </div>
  );
}

export function ParseWarnings({ snapshot }: { snapshot: ShowFlowSnapshot }) {
  const [open, setOpen] = useState(false);
  const total = snapshot.warnings.length + snapshot.validationProblems.length;
  if (!total) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="text-no-warnings">
        No parse warnings — all {snapshot.rows.length} rows converted cleanly.
      </p>
    );
  }
  return (
    <div className="rounded-md border border-cue-yellow/30 bg-cue-yellow/[0.06]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover-elevate"
        data-testid="button-toggle-warnings"
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-cue-yellow" />
        <span className="whitespace-nowrap font-medium">
          {total} parse warning{total === 1 ? '' : 's'}
        </span>
        <span className="hidden truncate text-xs text-muted-foreground sm:inline">
          non-blocking — rows still converted
        </span>
        <ChevronDown
          className={`ml-auto h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <ul className="max-h-64 space-y-1 overflow-y-auto border-t border-cue-yellow/20 px-3 py-2 text-xs">
          {snapshot.validationProblems.map((p) => (
            <li key={p} className="text-destructive-foreground/90">
              <Badge variant="destructive" className="mr-2 align-middle">
                invalid
              </Badge>
              {p}
            </li>
          ))}
          {snapshot.warnings.map((w, i) => (
            <li key={`${w.row}-${w.field}-${i}`} className="flex flex-wrap gap-x-2 text-muted-foreground">
              <span className="cue-cell text-foreground/80">row {w.row}</span>
              <span className="cue-cell text-muted-foreground">
                {w.cue ? `cue ${w.cue}` : '—'}
              </span>
              <span className="font-medium text-foreground/70">{w.field}</span>
              <span className="min-w-0 flex-1 break-words">{w.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RundownPreview({ snapshot }: { snapshot: ShowFlowSnapshot }) {
  const [query, setQuery] = useState('');
  const [colourFilter, setColourFilter] = useState<ColourName | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return snapshot.rows.filter((r) => {
      if (colourFilter && r.colour !== colourFilter) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.cue.toLowerCase().includes(q) ||
        r.note.toLowerCase().includes(q) ||
        Object.values(r.custom).some((v) => v.toLowerCase().includes(q))
      );
    });
  }, [snapshot.rows, query, colourFilter]);

  const totalMs = snapshot.rows.reduce((sum, r) => sum + r.durationMs, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter cues, titles, notes…"
            className="h-8 pl-8 text-sm"
            data-testid="input-filter-cues"
          />
        </div>
        <div className="flex items-center gap-1">
          {(Object.keys(COLOUR_HEX) as ColourName[]).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setColourFilter((c) => (c === name ? null : name))}
              aria-pressed={colourFilter === name}
              title={`${name} — ${COLOUR_MEANING[name]}`}
              data-testid={`button-filter-${name}`}
              className={`h-6 rounded-sm border px-2 text-[11px] capitalize transition-colors ${
                colourFilter === name
                  ? 'border-transparent text-background'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
              style={
                colourFilter === name
                  ? { backgroundColor: COLOUR_HEX[name], color: '#0b0d10' }
                  : undefined
              }
            >
              {name}
            </button>
          ))}
        </div>
        <span className="cue-cell shrink-0 whitespace-nowrap text-xs text-muted-foreground" data-testid="text-row-count">
          {rows.length}/{snapshot.rows.length} cues · {formatMsDuration(totalMs)} total
        </span>
      </div>

      {/* desktop table */}
      <div className="hidden overflow-hidden rounded-md border border-card-border sm:block">
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-card panel-grid text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-card-border">
                <th className="w-14 px-3 py-2 text-left font-medium">Cue</th>
                <th className="w-28 px-2 py-2 text-left font-medium">Start</th>
                <th className="w-20 px-2 py-2 text-left font-medium">Dur</th>
                <th className="px-2 py-2 text-left font-medium">Title</th>
                <th className="w-24 px-2 py-2 text-left font-medium">Timer</th>
                <th className="hidden px-2 py-2 text-left font-medium lg:table-cell">Fields</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.rowNumber}-${row.cue}`}
                  className="border-b border-border/40 align-top last:border-0"
                  style={{
                    backgroundColor: tint(row.colourHex, '12'),
                    boxShadow: row.colourHex ? `inset 3px 0 0 0 ${row.colourHex}` : undefined,
                  }}
                  data-testid={`row-cue-${row.cue}`}
                >
                  <td className="cue-cell px-3 py-2 font-medium">{row.cue || '—'}</td>
                  <td className="cue-cell whitespace-nowrap px-2 py-2 text-muted-foreground">
                    {formatMsClock(row.timeStart)}
                    {row.dayOffset > 0 && (
                      <span className="ml-1 text-[10px] text-cue-purple">+{row.dayOffset}d</span>
                    )}
                  </td>
                  <td className="cue-cell px-2 py-2 text-muted-foreground">
                    {formatMsDuration(row.durationMs)}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-1 h-2 w-2 shrink-0 rounded-sm"
                        style={{ backgroundColor: row.colourHex || 'transparent' }}
                        title={colourLabel(row)}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <div className="break-words font-medium leading-snug">
                          {row.title || <span className="text-muted-foreground">Untitled</span>}
                        </div>
                        {row.note && (
                          <div className="mt-0.5 break-words text-xs italic text-muted-foreground">
                            {row.note}
                          </div>
                        )}
                        <div className="mt-1 lg:hidden">
                          <CustomChips row={row} order={snapshot.customFieldOrder} />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={`cue-cell rounded-sm px-1.5 py-0.5 text-[11px] ${
                        row.timerType === 'count-down'
                          ? 'bg-cue-blue/20 text-cue-blue'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {row.timerType}
                    </span>
                    {!row.linkStart && (
                      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        pinned
                      </div>
                    )}
                  </td>
                  <td className="hidden max-w-[22rem] px-2 py-2 lg:table-cell">
                    <CustomChips row={row} order={snapshot.customFieldOrder} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* mobile stacked list */}
      <ul className="space-y-2 sm:hidden">
        {rows.map((row) => (
          <li
            key={`m-${row.rowNumber}-${row.cue}`}
            className="rounded-md border border-card-border p-3"
            style={{
              backgroundColor: tint(row.colourHex, '12'),
              boxShadow: row.colourHex ? `inset 3px 0 0 0 ${row.colourHex}` : undefined,
            }}
            data-testid={`card-cue-${row.cue}`}
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="cue-cell font-medium">CUE {row.cue || '—'}</span>
              <span className="cue-cell text-muted-foreground">
                {formatMsClock(row.timeStart)} · {formatMsDuration(row.durationMs)}
              </span>
            </div>
            <div className="mt-1 break-words text-sm font-medium leading-snug">{row.title}</div>
            {row.note && (
              <div className="mt-1 break-words text-xs italic text-muted-foreground">{row.note}</div>
            )}
            <div className="mt-2 flex items-center gap-2">
              <span className="cue-cell rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {row.timerType}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {colourLabel(row)}
              </span>
            </div>
            <div className="mt-2">
              <CustomChips row={row} order={snapshot.customFieldOrder} />
            </div>
          </li>
        ))}
      </ul>

      {rows.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          No cues match this filter.
        </p>
      )}
    </div>
  );
}
