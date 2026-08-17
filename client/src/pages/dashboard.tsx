import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Coffee,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  Moon,
  RefreshCw,
  Settings2,
  Sun,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { ColourLegend, ParseWarnings, RundownPreview } from '@/components/rundown-preview';
import { TargetsPanel } from '@/components/targets-panel';
import { api, errorText, type ShowFlowSnapshot } from '@/lib/api';
import { API_BASE, apiRequest } from '@/lib/queryClient';
import type { Settings as AppSettings } from '@shared/schema';

function useDarkMode() {
  const [dark, setDark] = useState(true); // dark-first: this runs in show control rooms
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  return { dark, setDark };
}

function SettingsDialog({
  open,
  onOpenChange,
  settings,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings?: AppSettings;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [sheetId, setSheetId] = useState(settings?.sheetId ?? '');
  const [tabName, setTabName] = useState(settings?.tabName ?? '');
  const [showName, setShowName] = useState(settings?.showName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [tabOptions, setTabOptions] = useState<string[]>([]);
  const [tabsError, setTabsError] = useState<string | null>(null);
  const [manualTabEntry, setManualTabEntry] = useState(false);

  const fetchTabs = useMutation({
    mutationFn: (id: string) => api.getSheetTabs(id),
    onSuccess: (data) => {
      setTabOptions(data.tabs);
      setTabsError(null);
    },
    onError: (err) => {
      setTabOptions([]);
      setTabsError(errorText(err));
    },
  });

  useEffect(() => {
    if (open && settings) {
      setSheetId(settings.sheetId);
      setTabName(settings.tabName);
      setShowName(settings.showName);
      setError(null);
      setManualTabEntry(false);
      setTabOptions([]);
      setTabsError(null);
      if (settings.sheetId.trim()) fetchTabs.mutate(settings.sheetId.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings]);

  const save = useMutation({
    mutationFn: () => api.saveSettings({ sheetId: sheetId.trim(), tabName: tabName.trim(), showName: showName.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/settings'] });
      qc.invalidateQueries({ queryKey: ['/api/showflow'] });
      toast({ title: 'Sheet source updated', description: 'Fetch the sheet again to reload the rundown.' });
      onOpenChange(false);
    },
    onError: (err) => setError(errorText(err)),
  });

  const clearAll = useMutation({
    mutationFn: api.resetAll,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/settings'] });
      qc.invalidateQueries({ queryKey: ['/api/targets'] });
      qc.invalidateQueries({ queryKey: ['/api/showflow'] });
      setSheetId('');
      setTabName('');
      setShowName('');
      setError(null);
      setClearOpen(false);
      setTabOptions([]);
      setTabsError(null);
      setManualTabEntry(false);
      onOpenChange(false);
      toast({
        title: 'All settings cleared',
        description: 'Sheet source and sync targets are back to defaults.',
      });
    },
    onError: (err) => {
      setClearOpen(false);
      setError(errorText(err));
    },
  });

  const REQUIRED_COLUMNS: Array<[string, ReactNode]> = [
    ['Cue #', 'sequential: 1, 2, 3…'],
    ['Start Time', 'clock time — e.g. 9:00 AM'],
    ['Duration', 'e.g. 0:05:00'],
    ['End Time', 'start + duration'],
    ['Linkstart', 'TRUE = starts when the previous item ends · FALSE = pinned to Start Time'],
    ['Title', 'what shows in Ontime'],
    ['Timer Type', <><span className="font-mono">count-down</span> for a countdown timer, <span className="font-mono">none</span> otherwise — drop the whole column to infer it from Colour (Blue → count-down)</>],
    ['Colour', <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#FFCC78' }} title="Yellow — videos" />
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#77C785' }} title="Green — breaks / walk-ins" />
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#A790F5' }} title="Purple — intros / outros" />
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#779BE7' }} title="Blue — segments" />
      <span>Yellow · Green · Purple · Blue</span>
    </span>],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg" data-testid="dialog-settings">
        <DialogHeader>
          <DialogTitle>Show flow source</DialogTitle>
          <DialogDescription>
            One Google Sheet tab is the single source of truth. It must be shared as “Anyone with the
            link can view”.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="show-name">Show name</Label>
            <Input id="show-name" value={showName} onChange={(e) => setShowName(e.target.value)} data-testid="input-show-name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sheet-id">Google Sheet ID</Label>
            <Input
              id="sheet-id"
              value={sheetId}
              onChange={(e) => {
                setSheetId(e.target.value);
                setTabOptions([]);
                setTabsError(null);
              }}
              onBlur={() => {
                const id = sheetId.trim();
                if (id) fetchTabs.mutate(id);
              }}
              className="font-mono text-sm"
              data-testid="input-sheet-id"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="tab-name">Tab name</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
                onClick={() => sheetId.trim() && fetchTabs.mutate(sheetId.trim())}
                disabled={!sheetId.trim() || fetchTabs.isPending}
                data-testid="button-refresh-tabs"
              >
                {fetchTabs.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Load tabs
              </Button>
            </div>
            {tabOptions.length > 0 && !manualTabEntry ? (
              <>
                <Select
                  value={tabOptions.includes(tabName) ? tabName : undefined}
                  onValueChange={setTabName}
                >
                  <SelectTrigger id="tab-name" className="font-mono text-sm" data-testid="select-tab-name">
                    <SelectValue placeholder="Choose a tab…" />
                  </SelectTrigger>
                  <SelectContent>
                    {tabOptions.map((name) => (
                      <SelectItem key={name} value={name} className="font-mono text-sm">
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:underline"
                  onClick={() => setManualTabEntry(true)}
                  data-testid="button-type-tab-manually"
                >
                  Type the tab name instead
                </button>
              </>
            ) : (
              <>
                <Input
                  id="tab-name"
                  value={tabName}
                  onChange={(e) => setTabName(e.target.value)}
                  className="font-mono text-sm"
                  data-testid="input-tab-name"
                />
                {tabOptions.length > 0 && (
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:underline"
                    onClick={() => setManualTabEntry(false)}
                    data-testid="button-use-tab-dropdown"
                  >
                    Choose from the {tabOptions.length} tabs found instead
                  </button>
                )}
                {tabsError && (
                  <p className="text-[11px] text-muted-foreground" data-testid="text-tabs-error">
                    {tabsError} — you can still type the tab name manually.
                  </p>
                )}
              </>
            )}
          </div>
          {error && <p className="text-sm text-destructive" data-testid="text-settings-error">{error}</p>}

          <div className="rounded-md border border-border bg-muted/40 px-3 py-3" data-testid="section-sheet-format">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sheet format — 8 required columns
            </p>
            <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {REQUIRED_COLUMNS.map(([name, hint]) => (
                <div key={name} className="text-[11px] leading-snug">
                  <span className="font-mono text-xs font-semibold text-foreground">{name}</span>
                  <span className="block text-muted-foreground">{hint}</span>
                </div>
              ))}
            </div>
            <p className="mt-2.5 border-t border-border pt-2 text-[11px] leading-snug text-muted-foreground" data-testid="text-aux-timer-callout">
              <span className="font-mono text-xs font-semibold text-foreground">Aux Timer</span>
              <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">optional · special</span>
              <span className="block">
                Put a duration (e.g. <span className="font-mono">1:00:00</span>) on the row where Ontime's aux timer should reset and
                start counting down; <span className="font-mono">00:00:00</span> clears it (stops and blanks displays until the next
                reset); <span className="font-mono">none</span> or blank elsewhere. Synced as Ontime automations — not a custom field.
                It keeps running across items and stops with the show.
              </span>
            </p>
            <p className="mt-2 border-t border-border pt-2 text-[11px] leading-snug text-muted-foreground">
              Any extra column after these becomes an Ontime <span className="font-medium text-foreground">custom field</span> automatically
              (e.g. Video, Lighting, Audio, Speakers). A <span className="font-mono">Notes</span> column fills the Ontime note instead.
            </p>
            <a
              href={`${API_BASE}/showflow-template.xlsx`}
              download
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              data-testid="link-template-download"
            >
              <Download className="h-3.5 w-3.5" />
              Download the annotated Excel template
            </a>
            <span className="block text-[11px] text-muted-foreground">
              Import it into Google Sheets (File → Import) — hover any header cell for full instructions.
            </span>
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setClearOpen(true)}
            data-testid="button-clear-all-settings"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Clear all settings
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-settings">
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save source
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent data-testid="dialog-confirm-clear-all">
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all settings?</AlertDialogTitle>
            <AlertDialogDescription>
              This wipes the saved sheet source (show name, sheet ID, tab name), every sync
              target (Ontime Cloud and local URLs, tokens), and the sync history. It cannot be
              undone. You'll need to re-enter everything from scratch.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-clear-all">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => clearAll.mutate()}
              disabled={clearAll.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-clear-all"
            >
              {clearAll.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Clear everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

export default function Dashboard() {
  const { dark, setDark } = useDarkMode();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const { data: settings } = useQuery<AppSettings>({ queryKey: ['/api/settings'] });
  const { data: snapshot, isLoading: snapshotLoading } = useQuery<ShowFlowSnapshot | null>({
    queryKey: ['/api/showflow'],
  });

  const fetchSheet = useMutation({
    mutationFn: api.fetchSheet,
    onSuccess: (data) => {
      setFetchError(null);
      qc.setQueryData(['/api/showflow'], data);
      toast({
        title: 'Sheet fetched',
        description: `${data.rows.length} cues parsed${data.warnings.length ? ` · ${data.warnings.length} warning${data.warnings.length === 1 ? '' : 's'}` : ''}`,
      });
    },
    onError: (err) => setFetchError(errorText(err)),
  });

  async function downloadJson() {
    try {
      const res = await apiRequest('GET', '/api/showflow/export');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mosctools_${(snapshot?.showName ?? 'showflow').toLowerCase().replace(/[^a-z0-9]+/g, '_')}_ontime_project.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast({ title: 'Rundown JSON exported', description: 'Import it in Ontime → Manage projects.' });
    } catch (err) {
      window.open(`${API_BASE}/api/showflow/export`, '_blank');
      toast({
        variant: 'destructive',
        title: 'Download blocked',
        description: 'Opened the JSON in a new tab instead.',
      });
    }
  }

  const lastFetched = snapshot?.fetchedAt ? new Date(snapshot.fetchedAt) : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src="/mosc-tools-logo.png"
              alt="Mosc-Tools"
              className="h-10 w-10 shrink-0 rounded-full"
              data-testid="img-brand-logo"
            />
            <div className="min-w-0">
              <h1
                className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm font-semibold tracking-tight"
                data-testid="text-brand"
              >
                <span className="truncate">Mosc-tools</span>
                <span className="truncate text-xs font-normal text-muted-foreground">
                  Ontime Show Flow Sync
                </span>
              </h1>
              <p className="truncate text-xs text-muted-foreground" data-testid="text-show-name">
                {settings?.showName || 'No show configured'}
                {settings?.tabName && (
                  <span className="ml-1.5 hidden font-mono text-[11px] text-muted-foreground/80 sm:inline">
                    {settings.tabName}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <a
              href="https://buymeacoffee.com/mosctools"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#FFDD00] px-3 py-1.5 text-xs font-semibold text-black shadow-sm transition-transform hover:scale-[1.03]"
              data-testid="link-buy-me-a-coffee"
            >
              <Coffee className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">Enjoying this tool?</span>
              <span>Buy Me a Coffee</span>
            </a>
            {lastFetched && (
              <span className="cue-cell hidden text-xs text-muted-foreground sm:inline" data-testid="text-last-fetched">
                fetched {lastFetched.toLocaleTimeString()}
              </span>
            )}
            <Button
              size="sm"
              onClick={() => fetchSheet.mutate()}
              disabled={fetchSheet.isPending}
              data-testid="button-fetch-sheet"
            >
              {fetchSheet.isPending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
              )}
              Fetch sheet
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={downloadJson}
              disabled={!snapshot}
              data-testid="button-download-json"
            >
              <Download className="mr-2 h-3.5 w-3.5" /> Download rundown JSON
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setSettingsOpen(true)}
              aria-label="Show flow source settings"
              data-testid="button-open-settings"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setDark(!dark)}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              data-testid="button-toggle-theme"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] space-y-6 px-4 py-6 sm:px-6">
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide">Rundown preview</h2>
            {snapshot && (
              <a
                href={snapshot.sheetUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                data-testid="link-source-sheet"
              >
                Source sheet <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {fetchError && (
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-3 text-sm"
              data-testid="text-fetch-error"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="font-medium">Could not read the show flow</p>
                <p className="mt-0.5 break-words text-muted-foreground">{fetchError}</p>
              </div>
            </div>
          )}

          {snapshotLoading && (
            <div className="h-64 animate-pulse rounded-md border border-card-border bg-card" />
          )}

          {!snapshotLoading && !snapshot && (
            <div
              className="rounded-md border border-dashed border-border px-6 py-12 text-center"
              data-testid="empty-state-showflow"
            >
              <FileSpreadsheet className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">No show flow loaded</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                {settings?.sheetId?.trim()
                  ? `Fetch the “${settings.tabName}” tab to parse the show flow and build the Ontime rundown.`
                  : 'Open Settings (the gear icon, top right) to point this tool at your Google Sheet, then fetch it to build the Ontime rundown.'}
              </p>
              <Button
                className="mt-4"
                size="sm"
                onClick={() => fetchSheet.mutate()}
                disabled={fetchSheet.isPending}
                data-testid="button-fetch-sheet-empty"
              >
                {fetchSheet.isPending ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                )}
                Fetch sheet
              </Button>
            </div>
          )}

          {snapshot && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-card-border bg-card px-3 py-2">
                <ColourLegend />
                <span className="cue-cell text-xs text-muted-foreground">
                  {snapshot.entryCount} entries · {Object.keys(snapshot.customFields).length} custom fields
                  {snapshot.auxAutomations?.length
                    ? ` · aux timer on cue ${snapshot.auxAutomations.map((a) => a.cue).join(', ')}`
                    : ''}
                </span>
              </div>
              <ParseWarnings snapshot={snapshot} />
              <RundownPreview snapshot={snapshot} />
            </>
          )}
        </section>

        <TargetsPanel snapshot={snapshot ?? null} />

        <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
          <p>
            Ontime v4 import via <span className="font-mono">POST /data/rundowns/import</span> · custom-field
            keys follow Ontime's <span className="font-mono">key === label.replaceAll(' ', '_')</span> rule ·
            all Ontime calls are proxied by this app's backend.
          </p>
          <p className="mt-1.5" data-testid="text-support-contact">
            Technical support:{' '}
            <a href="mailto:mosc-tools@moscone.ca" className="text-primary hover:underline">
              mosc-tools@moscone.ca
            </a>
          </p>
          <p className="mt-1.5" data-testid="text-last-updated">
            Last updated:{' '}
            {new Date(__BUILD_DATE__).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
            {' · '}
            <a
              href="https://github.com/professorpete/mosc-tools-ontime-sync"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              View on GitHub
            </a>
          </p>
        </footer>
      </main>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} />
    </div>
  );
}
