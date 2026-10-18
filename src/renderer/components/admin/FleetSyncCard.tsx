import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, LogIn, RefreshCw } from 'lucide-react';
import type { FleetSyncStatus } from '../../../shared/types';
import { LoadingState, Notice, PageSection, Panel, StatusText, type NoticeTone, type Tone } from './AdminKit';
import { dateTimeLabel, relativeTime } from './fleetFormat';
import { OWNER_PIN_MESSAGES, type OwnerSession } from './useOwnerSession';

const STATUS_REFRESH_MS = 30_000;

function syncState(status: FleetSyncStatus): { label: string; tone: Tone; detail: string } {
  if (!status.configured) {
    return { label: 'Not set up', tone: 'neutral', detail: 'Cloud sync is not set up on this device.' };
  }
  if (status.removedByOwner) {
    return {
      label: 'Removed by main admin',
      tone: 'danger',
      detail: 'The main admin removed this device. It keeps working here but stops syncing until it rejoins.'
    };
  }
  if (status.needsRejoin) {
    return {
      label: 'Rejoin needed',
      tone: 'warning',
      detail: 'All devices already lists this device ID from an earlier install. Rejoin with the main admin PIN to link this one.'
    };
  }
  if (!status.registered) {
    return { label: 'Not registered', tone: 'warning', detail: 'This device registers itself the next time it is online.' };
  }
  if (status.syncing) return { label: 'Syncing...', tone: 'info', detail: 'Sending sessions and games to the cloud.' };
  if (status.lastSyncError) return { label: 'Sync failed', tone: 'danger', detail: status.lastSyncError };
  if (status.lastSyncAt) return { label: 'Synced', tone: 'success', detail: 'Sessions, games and device details are up to date.' };
  return { label: 'Waiting to sync', tone: 'warning', detail: 'This device has not synced yet.' };
}

/** This device's link to the main admin's All devices: sync state, Sync now and, after removal, Rejoin. */
export function FleetSyncCard(props: {
  /** Needed for Rejoin, which asks for the main admin PIN. */
  owner?: OwnerSession;
  /** Section heading; "Cloud sync" by default. */
  title?: string;
  className?: string;
  /** Called after a sync or rejoin so the page can refresh what it shows. */
  onSynced?: () => void;
}): JSX.Element {
  const [status, setStatus] = useState<FleetSyncStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [action, setAction] = useState<'' | 'sync' | 'rejoin'>('');
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const { onSynced, owner } = props;

  const loadStatus = useCallback(async (): Promise<void> => {
    try {
      setStatus(await window.nxgs.getFleetSyncStatus());
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    const timer = window.setInterval(() => void loadStatus(), STATUS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadStatus]);

  const syncNow = async (): Promise<void> => {
    if (action) return;
    setAction('sync');
    setNotice(null);
    try {
      const next = await window.nxgs.syncFleetNow();
      setStatus(next);
      setNotice(next.lastSyncError
        ? { tone: 'error', text: next.lastSyncError }
        : { tone: 'success', text: 'Sync finished.' });
      onSynced?.();
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setAction('');
    }
  };

  const rejoin = async (): Promise<void> => {
    if (action || !owner) return;
    setAction('rejoin');
    setNotice(null);
    try {
      const result = await owner.run(() => window.nxgs.rejoinFleet(), OWNER_PIN_MESSAGES.rejoin);
      if (result.ok) {
        if (result.data) setStatus(result.data);
        else await loadStatus();
        setNotice({ tone: 'success', text: 'Rejoined. This device is back in All devices.' });
        onSynced?.();
      } else if (result.code !== 'owner_pin_required') {
        setNotice({ tone: 'error', text: result.error ?? 'Could not rejoin All devices.' });
      }
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setAction('');
    }
  };

  const state = status ? syncState(status) : null;
  // The last error only gets its own row when the description is not already showing it.
  const showError = Boolean(
    status?.lastSyncError && status.configured && !status.removedByOwner && !status.needsRejoin && state?.detail !== status.lastSyncError
  );

  return (
    <PageSection
      title={props.title ?? 'Cloud sync'}
      description={state?.detail ?? 'Sends sessions and games so the main admin can see every device.'}
      className={`fleet-sync${props.className ? ` ${props.className}` : ''}`}
      actions={(
        <>
          {status && (status.needsRejoin || status.removedByOwner) && owner && (
            <button className="admin-btn admin-btn--primary admin-btn--sm" type="button" disabled={Boolean(action)} onClick={() => void rejoin()}>
              {action === 'rejoin' ? <LoaderCircle className="spin" size={14} /> : <LogIn size={14} />}
              {action === 'rejoin' ? 'Rejoining...' : 'Rejoin'}
            </button>
          )}
          <button
            className="admin-btn admin-btn--sm"
            type="button"
            disabled={Boolean(action) || !status || !status.configured || status.removedByOwner || status.needsRejoin || status.syncing}
            onClick={() => void syncNow()}
          >
            {action === 'sync' || status?.syncing ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
            {action === 'sync' ? 'Syncing...' : 'Sync now'}
          </button>
        </>
      )}
    >
      {!status && !loadError && <LoadingState label="Checking sync..." />}
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {status && state && (
        <Panel padding="rows">
          <dl className="admin-meta-list admin-meta-list--left fleet-sync-meta">
            <div>
              <dt>Status</dt>
              <dd><StatusText tone={state.tone}>{state.label}</StatusText></dd>
            </div>
            <div>
              <dt>Registered</dt>
              <dd>{status.removedByOwner ? 'Removed' : status.needsRejoin ? 'Needs rejoin' : status.registered ? 'Yes' : 'Not yet'}</dd>
            </div>
            <div>
              <dt>Last sync</dt>
              <dd title={status.lastSyncAt ? dateTimeLabel(status.lastSyncAt) : undefined}>
                {status.lastSyncAt ? `${relativeTime(status.lastSyncAt)} · ${dateTimeLabel(status.lastSyncAt)}` : 'Not synced yet'}
              </dd>
            </div>
            <div><dt>Sessions waiting</dt><dd>{status.pendingSessions}</dd></div>
            {showError && (
              <div><dt>Last error</dt><dd className="fleet-sync-error">{status.lastSyncError}</dd></div>
            )}
          </dl>
        </Panel>
      )}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    </PageSection>
  );
}
