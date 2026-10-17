import { useCallback, useEffect, useState } from 'react';
import { Cloud, CloudOff, LoaderCircle, LogIn, RefreshCw } from 'lucide-react';
import type { FleetSyncStatus } from '../../../shared/types';
import { CardHeader, LoadingState, Notice, type NoticeTone } from './AdminKit';
import { dateTimeLabel, relativeTime } from './fleetFormat';
import { OWNER_PIN_MESSAGES, type OwnerSession } from './useOwnerSession';

const STATUS_REFRESH_MS = 30_000;

function syncState(status: FleetSyncStatus): { label: string; tone: string; detail: string } {
  if (!status.configured) {
    return { label: 'Not set up', tone: '', detail: 'Cloud sync is not set up on this device.' };
  }
  if (status.removedByOwner) {
    return {
      label: 'Removed by main admin',
      tone: 'ps-chip--danger',
      detail: 'The main admin removed this device. It keeps working here but stops syncing until it rejoins.'
    };
  }
  if (status.needsRejoin) {
    return {
      label: 'Rejoin needed',
      tone: 'ps-chip--warning',
      detail: 'Device Management already has this device ID from an earlier install. Rejoin with the main admin PIN to link this one.'
    };
  }
  if (!status.registered) {
    return { label: 'Not registered', tone: 'ps-chip--warning', detail: 'This device registers itself the next time it is online.' };
  }
  if (status.syncing) return { label: 'Syncing...', tone: 'ps-chip--accent', detail: 'Sending sessions and games to the cloud.' };
  if (status.lastSyncError) return { label: 'Sync failed', tone: 'ps-chip--danger', detail: status.lastSyncError };
  if (status.lastSyncAt) return { label: 'Synced', tone: 'ps-chip--success', detail: 'Sessions, games and device details are up to date.' };
  return { label: 'Waiting to sync', tone: 'ps-chip--warning', detail: 'This device has not synced yet.' };
}

/** This device's link to Device Management: sync state, Sync now and, after removal, Rejoin. */
export function FleetSyncCard(props: {
  /** Needed for Rejoin, which asks for the main admin PIN. */
  owner?: OwnerSession;
  eyebrow?: string;
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
        setNotice({ tone: 'success', text: 'This device rejoined Device Management.' });
        onSynced?.();
      } else if (result.code !== 'owner_pin_required') {
        setNotice({ tone: 'error', text: result.error ?? 'Could not rejoin Device Management.' });
      }
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setAction('');
    }
  };

  const state = status ? syncState(status) : null;

  return (
    <section className={`admin-card fleet-sync-card${props.className ? ` ${props.className}` : ''}`}>
      <CardHeader
        eyebrow={props.eyebrow ?? 'This device'}
        title="Cloud sync"
        subtitle={state?.detail ?? 'Sends sessions and games so the main admin can see every device.'}
        icon={status && (!status.configured || status.removedByOwner || status.needsRejoin) ? <CloudOff size={20} /> : <Cloud size={20} />}
      />
      {state && (
        <div className="fleet-sync-state">
          <span className={`ps-chip device-status-pill ${state.tone}`}>{state.label}</span>
        </div>
      )}
      {!status && !loadError && <LoadingState label="Checking sync..." />}
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {status && (
        <dl className="admin-meta-list fleet-sync-meta">
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
          {status.lastSyncError && status.configured && !status.removedByOwner && !status.needsRejoin && (
            <div><dt>Last error</dt><dd className="fleet-sync-error">{status.lastSyncError}</dd></div>
          )}
        </dl>
      )}
      <footer className="admin-card-footer fleet-sync-footer">
        {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : <span aria-hidden="true" />}
        <div className="fleet-sync-actions">
          {status && (status.needsRejoin || status.removedByOwner) && owner && (
            <button className="primary-action" type="button" disabled={Boolean(action)} onClick={() => void rejoin()}>
              {action === 'rejoin' ? <LoaderCircle className="spin" size={18} /> : <LogIn size={18} />}
              {action === 'rejoin' ? 'Rejoining...' : 'Rejoin'}
            </button>
          )}
          <button
            className="secondary-action"
            type="button"
            disabled={Boolean(action) || !status || !status.configured || status.removedByOwner || status.needsRejoin || status.syncing}
            onClick={() => void syncNow()}
          >
            {action === 'sync' || status?.syncing ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}
            {action === 'sync' ? 'Syncing...' : 'Sync now'}
          </button>
        </div>
      </footer>
    </section>
  );
}
