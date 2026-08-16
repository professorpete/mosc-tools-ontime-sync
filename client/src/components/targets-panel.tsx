import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  CheckCircle2,
  CircleDashed,
  Eye,
  EyeOff,
  GitCompareArrows,
  KeyRound,
  ListPlus,
  Loader2,
  Pencil,
  Plus,
  Radio,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  api,
  errorText,
  parseSyncSummary,
  type DiffResult,
  type ShowFlowSnapshot,
  type SyncResult,
  type SyncSummary,
  type TargetWithHistory,
  type TestResult,
} from '@/lib/api';
import type { DiffCueRow } from '@shared/showflow';

type Mode = 'override' | 'merge' | 'new';

const MODE_COPY: Record<Mode, string> = {
  override: 'Replace the target rundown entirely with the sheet (recommended).',
  merge: 'Update matching entries and append new ones, leaving other entries in place.',
  new: 'Create a brand-new rundown in Ontime and load it.',
};

/** "X added · Y changed · Z removed · W unchanged" — the shared wording for push results. */
function countsText(s: Partial<SyncSummary> | null | undefined): string | null {
  if (!s || typeof s.added !== 'number') return null;
  const base = `${s.added} added · ${s.changed ?? 0} changed · ${s.removed ?? 0} removed · ${s.unchanged ?? 0} unchanged`;
  return typeof s.automations === 'number' && s.automations > 0
    ? `${base} · ${s.automations} aux automations`
    : base;
}

function StatusDot({ state }: { state: 'unknown' | 'ok' | 'error' }) {
  const cls =
    state === 'ok'
      ? 'bg-cue-green shadow-[0_0_8px] shadow-cue-green/60'
      : state === 'error'
        ? 'bg-destructive shadow-[0_0_8px] shadow-destructive/50'
        : 'bg-muted-foreground/50';
  return <span className={`h-2 w-2 rounded-full ${cls}`} aria-hidden />;
}

function DiffList({ title, rows, tone }: { title: string; rows: DiffCueRow[]; tone: string }) {
  if (!rows.length) return null;
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
        <span className={tone}>{title}</span>
        <span className="cue-cell text-muted-foreground">{rows.length}</span>
      </div>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li
            key={`${title}-${row.cue}`}
            className="rounded-sm border border-border/60 bg-muted/25 px-2 py-1.5 text-xs"
            style={{ boxShadow: row.colour ? `inset 3px 0 0 0 ${row.colour}` : undefined }}
            data-testid={`diff-${title.toLowerCase()}-${row.cue}`}
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="cue-cell font-medium">{row.cue}</span>
              <span className="min-w-0 break-words">{row.title}</span>
            </div>
            {row.changes && (
              <ul className="mt-1 space-y-0.5 pl-1">
                {row.changes.map((c) => (
                  <li key={c.field} className="flex flex-wrap gap-1 text-[11px]">
                    <span className="cue-cell text-muted-foreground">{c.field}</span>
                    <span className="text-destructive/90 line-through decoration-destructive/40">
                      {c.from || '∅'}
                    </span>
                    <span className="text-muted-foreground">→</span>
                    <span className="text-cue-green">{c.to || '∅'}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TargetForm({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target?: TargetWithHistory;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(target?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(target?.baseUrl ?? '');
  const [authToken, setAuthToken] = useState(target?.authToken ?? '');
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form from the target each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName(target?.name ?? '');
    setBaseUrl(target?.baseUrl ?? '');
    setAuthToken(target?.authToken ?? '');
    setShowToken(false);
    setError(null);
  }, [open, target?.id, target?.name, target?.baseUrl, target?.authToken]);

  const save = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), baseUrl: baseUrl.trim(), authToken: authToken.trim() || null };
      return target ? api.updateTarget(target.id, body) : api.createTarget(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/targets'] });
      toast({ title: target ? 'Target updated' : 'Target added', description: name.trim() });
      onOpenChange(false);
      if (!target) {
        setName('');
        setBaseUrl('');
        setAuthToken('');
      }
    },
    onError: (err) => setError(errorText(err)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-target-form">
        <DialogHeader>
          <DialogTitle>{target ? `Edit ${target.name}` : 'Add Ontime target'}</DialogTitle>
          <DialogDescription>
            Point at an Ontime v4 server. Calls are made from this machine's backend, so a venue
            instance on localhost works fine.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="target-name">Name</Label>
            <Input
              id="target-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Venue (local)"
              data-testid="input-target-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="target-url">Base URL</Label>
            <Input
              id="target-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://cloud.getontime.no/your-stage"
              className="font-mono text-sm"
              data-testid="input-target-url"
            />
            <p className="text-xs text-muted-foreground">
              Local venue machines are usually <span className="font-mono">http://localhost:4001</span>.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="target-token">Password / token (optional)</Label>
            <div className="relative">
              <Input
                id="target-token"
                type={showToken ? 'text' : 'password'}
                autoComplete="new-password"
                value={authToken ?? ''}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder="Leave blank if the instance is open"
                className="pr-10 font-mono text-sm"
                data-testid="input-target-token"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-1.5 text-muted-foreground hover-elevate"
                aria-label={showToken ? 'Hide password' : 'Show password'}
                data-testid="button-toggle-token-visibility"
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              For password-protected Ontime instances. Sent on every call to this target as an{' '}
              <span className="font-mono">Authorization: Bearer</span> header and a{' '}
              <span className="font-mono">?token=</span> query parameter. Stored locally with the target
              and never shown on the card.
            </p>
          </div>
          {error && <p className="text-sm text-destructive" data-testid="text-target-form-error">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-cancel-target">
            Cancel
          </Button>
          <Button
            onClick={() => {
              setError(null);
              save.mutate();
            }}
            disabled={save.isPending || !name.trim()}
            data-testid="button-save-target"
          >
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {target ? 'Save changes' : 'Add target'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TargetCard({
  target,
  snapshot,
}: {
  target: TargetWithHistory;
  snapshot: ShowFlowSnapshot | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [test, setTest] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('override');
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const testMutation = useMutation({
    mutationFn: () => api.testTarget(target.id),
    onSuccess: (data) => {
      setTest(data);
      setTestError(null);
    },
    onError: (err) => {
      setTest(null);
      setTestError(errorText(err));
    },
  });

  const diffMutation = useMutation({
    mutationFn: () => api.diffTarget(target.id),
    onSuccess: (data) => {
      setDiff(data);
      setDiffError(null);
    },
    onError: (err) => {
      setDiff(null);
      setDiffError(errorText(err));
    },
  });

  /* Proposed name for a mode:'new' rundown, resolved by the backend against the instance. */
  const newName = useQuery({
    queryKey: ['/api/targets', target.id, 'new-rundown-name'],
    queryFn: () => api.newRundownName(target.id),
    enabled: confirmOpen && mode === 'new' && Boolean(snapshot) && Boolean(target.baseUrl.trim()),
    staleTime: 0,
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      api.syncTarget(target.id, {
        mode,
        targetRundownId: mode === 'new' ? undefined : (diff?.targetRundownId ?? test?.loadedRundownId),
      }),
    onSuccess: (data) => {
      setLastResult(data);
      qc.invalidateQueries({ queryKey: ['/api/targets'] });
      const counts = countsText(data.summary);
      toast({
        title: `Synced to ${target.name}`,
        description: [
          counts,
          data.mode === 'new' && data.rundownTitle ? `New rundown “${data.rundownTitle}”` : null,
          data.automationsWarning,
        ]
          .filter(Boolean)
          .join(' — '),
        ...(data.automationsWarning ? { variant: 'destructive' as const } : {}),
      });
      setConfirmOpen(false);
      diffMutation.mutate();
    },
    onError: (err) => {
      setLastResult(null);
      qc.invalidateQueries({ queryKey: ['/api/targets'] });
      toast({ variant: 'destructive', title: 'Sync failed', description: errorText(err) });
      setConfirmOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteTarget(target.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/targets'] });
      toast({ title: 'Target removed', description: target.name });
    },
  });

  const status: 'unknown' | 'ok' | 'error' = testError
    ? 'error'
    : test
      ? 'ok'
      : target.lastSyncStatus === 'error'
        ? 'error'
        : target.lastSyncStatus === 'success'
          ? 'ok'
          : 'unknown';

  const noUrl = !target.baseUrl.trim();
  const d = diff?.diff;

  return (
    <div
      className="rounded-md border border-card-border bg-card p-4"
      data-testid={`card-target-${target.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot state={status} />
            <h3 className="truncate text-sm font-semibold" data-testid={`text-target-name-${target.id}`}>
              {target.name}
            </h3>
          </div>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {target.baseUrl || 'no address set'}
          </p>
          {target.authToken?.trim() && (
            <p
              className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"
              data-testid={`text-target-password-set-${target.id}`}
            >
              <KeyRound className="h-3 w-3" /> password set
              <span className="cue-cell" aria-hidden>
                ••••••••
              </span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setEditOpen(true)}
            aria-label={`Edit ${target.name}`}
            data-testid={`button-edit-target-${target.id}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setDeleteOpen(true)}
            aria-label={`Delete ${target.name}`}
            data-testid={`button-delete-target-${target.id}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => testMutation.mutate()}
          disabled={noUrl || testMutation.isPending}
          data-testid={`button-test-target-${target.id}`}
        >
          {testMutation.isPending ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Radio className="mr-2 h-3.5 w-3.5" />
          )}
          Test connection
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => diffMutation.mutate()}
          disabled={noUrl || !snapshot || diffMutation.isPending}
          data-testid={`button-diff-target-${target.id}`}
        >
          {diffMutation.isPending ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
          )}
          Preview changes
        </Button>
        <Button
          size="sm"
          onClick={() => setConfirmOpen(true)}
          disabled={noUrl || !snapshot}
          data-testid={`button-sync-target-${target.id}`}
        >
          <Upload className="mr-2 h-3.5 w-3.5" />
          Sync to {target.name}
        </Button>
      </div>

      {noUrl && (
        <p className="mt-2 text-xs text-muted-foreground" data-testid={`text-target-no-url-${target.id}`}>
          Add a base URL to enable testing and syncing.
        </p>
      )}
      {!snapshot && !noUrl && (
        <p className="mt-2 text-xs text-muted-foreground">Fetch the sheet first to enable diff and sync.</p>
      )}

      {test && (
        <div
          className="mt-3 rounded-sm border border-cue-green/30 bg-cue-green/[0.07] px-2.5 py-2 text-xs"
          data-testid={`text-test-result-${target.id}`}
        >
          <div className="flex items-center gap-1.5 font-medium text-cue-green">
            <CheckCircle2 className="h-3.5 w-3.5" /> Connected
          </div>
          <div className="mt-1 space-y-0.5 text-muted-foreground">
            <div>
              Loaded rundown{' '}
              <span className="cue-cell text-foreground">
                {test.loadedRundownTitle ?? test.loadedRundownId}
              </span>{' '}
              <span className="cue-cell">({test.loadedRundownId})</span>
            </div>
            <div>
              {test.rundowns.length} rundown{test.rundowns.length === 1 ? '' : 's'} on this instance
              {test.customFieldCount !== null && ` · ${test.customFieldCount} custom fields`}
            </div>
          </div>
        </div>
      )}
      {testError && (
        <div
          className="mt-3 rounded-sm border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-xs"
          data-testid={`text-test-error-${target.id}`}
        >
          <div className="flex items-center gap-1.5 font-medium text-destructive">
            <XCircle className="h-3.5 w-3.5" /> Unreachable
          </div>
          <p className="mt-1 break-words text-muted-foreground">{testError}</p>
        </div>
      )}

      {diffError && (
        <p className="mt-3 rounded-sm border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-xs text-muted-foreground" data-testid={`text-diff-error-${target.id}`}>
          {diffError}
        </p>
      )}

      {d && (
        <div className="mt-3 space-y-3 rounded-md border border-border/70 bg-background/40 p-3" data-testid={`diff-panel-${target.id}`}>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">
              sheet <span className="cue-cell text-foreground">{diff?.generatedEntryCount}</span> cues →{' '}
              <span className="cue-cell text-foreground">{diff?.targetRundownTitle ?? diff?.targetRundownId}</span>{' '}
              <span className="cue-cell">({diff?.targetEntryCount} cues)</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="border-cue-green/50 text-cue-green" data-testid={`badge-added-${target.id}`}>
              +{d.added.length} added
            </Badge>
            <Badge variant="outline" className="border-cue-yellow/50 text-cue-yellow" data-testid={`badge-changed-${target.id}`}>
              ~{d.changed.length} changed
            </Badge>
            <Badge variant="outline" className="border-destructive/50 text-destructive" data-testid={`badge-removed-${target.id}`}>
              −{d.removed.length} removed
            </Badge>
            <Badge variant="outline" className="text-muted-foreground">
              {d.unchanged} unchanged
            </Badge>
            {d.isReordered && (
              <Badge variant="outline" className="border-cue-purple/50 text-cue-purple">
                order changed
              </Badge>
            )}
          </div>
          {d.extraTargetCustomFields.length > 0 && (
            <p className="rounded-sm border border-cue-yellow/30 bg-cue-yellow/[0.06] px-2 py-1.5 text-[11px] text-muted-foreground" data-testid={`text-extra-fields-${target.id}`}>
              This Ontime instance has custom fields the sheet does not provide:{' '}
              <span className="cue-cell text-foreground">{d.extraTargetCustomFields.join(', ')}</span>. An
              override sync leaves their declarations in place but the imported cues will not carry values
              for them.
            </p>
          )}
          {d.added.length + d.changed.length + d.removed.length === 0 ? (
            <p className="text-xs text-cue-green" data-testid={`text-in-sync-${target.id}`}>
              In sync — nothing to push.
            </p>
          ) : (
            <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
              <DiffList title="Changed" rows={d.changed} tone="text-cue-yellow" />
              <DiffList title="Removed" rows={d.removed} tone="text-destructive" />
              <DiffList title="Added" rows={d.added} tone="text-cue-green" />
            </div>
          )}
        </div>
      )}

      {lastResult && (
        <div
          className="mt-3 rounded-sm border border-cue-blue/40 bg-cue-blue/[0.07] px-2.5 py-2 text-xs"
          data-testid={`text-sync-result-${target.id}`}
        >
          <div className="flex items-center gap-1.5 font-medium text-cue-blue">
            <Upload className="h-3.5 w-3.5" /> Last push · {lastResult.mode}
          </div>
          <p className="mt-1 cue-cell text-foreground" data-testid={`text-sync-counts-${target.id}`}>
            {countsText(lastResult.summary) ?? '—'}
          </p>
          {lastResult.rundownTitle && (
            <p className="mt-0.5 text-muted-foreground" data-testid={`text-sync-rundown-${target.id}`}>
              {lastResult.mode === 'new' ? 'Created rundown' : 'Rundown'}{' '}
              <span className="text-foreground">{lastResult.rundownTitle}</span>
            </p>
          )}
        </div>
      )}

      <div className="mt-3 border-t border-border/60 pt-2">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Sync history</div>
        {target.history.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid={`text-no-history-${target.id}`}>
            No syncs yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {target.history.map((entry) => {
              const summary = parseSyncSummary(entry.summary);
              const counts = countsText(summary);
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-x-2 text-[11px]"
                  data-testid={`log-entry-${entry.id}`}
                >
                  {entry.status === 'success' ? (
                    <CheckCircle2 className="h-3 w-3 text-cue-green" />
                  ) : (
                    <XCircle className="h-3 w-3 text-destructive" />
                  )}
                  <span className="cue-cell text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                  <span className="text-muted-foreground">
                    {String(summary?.mode ?? '—')}
                    {summary?.total ? ` · ${summary.total} cues` : ''}
                  </span>
                  {counts && (
                    <span className="cue-cell text-foreground" data-testid={`log-counts-${entry.id}`}>
                      {counts}
                    </span>
                  )}
                  {summary?.rundownTitle && (
                    <span className="min-w-0 truncate text-muted-foreground" data-testid={`log-rundown-${entry.id}`}>
                      {summary.mode === 'new' ? '→ new: ' : '→ '}
                      {summary.rundownTitle}
                    </span>
                  )}
                  {entry.errorMessage && (
                    <span className="min-w-0 flex-1 break-words text-destructive/90">
                      {entry.errorMessage}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <TargetForm open={editOpen} onOpenChange={setEditOpen} target={target} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {target.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the target and its sync history from this app. Nothing changes inside Ontime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`button-cancel-delete-${target.id}`}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              data-testid={`button-confirm-delete-${target.id}`}
            >
              Remove target
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid={`dialog-confirm-sync-${target.id}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Sync to {target.name}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  This pushes{' '}
                  <span className="cue-cell text-foreground">{snapshot?.entryCount ?? 0} cues</span> from{' '}
                  <span className="text-foreground">{snapshot?.showName}</span> to{' '}
                  <span className="font-mono text-foreground">{target.baseUrl}</span> via{' '}
                  <span className="font-mono">POST /data/rundowns/import</span>.
                </p>
                {d ? (
                  <p>
                    Diff from the last preview: <span className="text-cue-green">+{d.added.length}</span>,{' '}
                    <span className="text-cue-yellow">~{d.changed.length}</span>,{' '}
                    <span className="text-destructive">−{d.removed.length}</span>.
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    No diff previewed yet — you are pushing the current sheet as-is.
                  </p>
                )}
                <p className="text-muted-foreground">{MODE_COPY[mode]}</p>
                {mode === 'new' && (
                  <p className="flex flex-wrap items-center gap-1.5" data-testid={`text-new-name-${target.id}`}>
                    <ListPlus className="h-3.5 w-3.5 text-cue-purple" />
                    <span className="text-muted-foreground">New rundown will be named</span>
                    <span className="cue-cell text-foreground">
                      {newName.isLoading ? 'resolving…' : (newName.data?.title ?? '—')}
                    </span>
                  </p>
                )}
                {mode === 'override' && (
                  <p className="text-cue-yellow">
                    Override replaces every entry in the target rundown{' '}
                    <span className="cue-cell">
                      {diff?.targetRundownId ?? test?.loadedRundownId ?? 'loaded rundown'}
                    </span>
                    . This cannot be undone from here.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`mode-${target.id}`}>Import mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <SelectTrigger id={`mode-${target.id}`} data-testid={`select-mode-${target.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="override">override — replace the loaded rundown</SelectItem>
                <SelectItem value="merge">merge — update and append</SelectItem>
                <SelectItem value="new">new — create a new rundown</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`button-cancel-sync-${target.id}`}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                syncMutation.mutate();
              }}
              disabled={syncMutation.isPending}
              data-testid={`button-confirm-sync-${target.id}`}
            >
              {syncMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Push {mode}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function TargetsPanel({ snapshot }: { snapshot: ShowFlowSnapshot | null }) {
  const [addOpen, setAddOpen] = useState(false);
  const { data: targets, isLoading } = useQuery<TargetWithHistory[]>({ queryKey: ['/api/targets'] });

  return (
    <section className="space-y-3" id="targets">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide">Ontime targets</h2>
          <p className="text-xs text-muted-foreground">
            Sync is always manual — preview the diff, then push.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} data-testid="button-add-target">
          <Plus className="mr-2 h-3.5 w-3.5" /> Add target
        </Button>
      </div>

      {isLoading && (
        <div className="grid gap-3 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-md border border-card-border bg-card" />
          ))}
        </div>
      )}

      {targets && targets.length === 0 && (
        <div className="rounded-md border border-dashed border-border px-4 py-8 text-center">
          <CircleDashed className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No Ontime targets yet. Add the venue machine or your cloud stage.
          </p>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {targets?.map((t) => (
          <TargetCard key={t.id} target={t} snapshot={snapshot} />
        ))}
      </div>

      <TargetForm open={addOpen} onOpenChange={setAddOpen} />
    </section>
  );
}
