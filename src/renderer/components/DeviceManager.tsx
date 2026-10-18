import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { DeviceInput, DeviceManagerSummary, DeviceRecord, DeviceStatus, FleetSyncStatus, SyncStatus } from '../../shared/types';
import { Field, LoadingState, Notice, PageSection, Panel, Stat, StatRow, StatusText, type Tone } from './admin/AdminKit';
import { FleetSyncCard } from './admin/FleetSyncCard';
import { dateTimeLabel, formatPaise } from './admin/fleetFormat';
import type { OwnerSession } from './admin/useOwnerSession';

type DeviceForm = {
  name: string;
  storeName: string;
  location: string;
  status: DeviceStatus;
};

const EMPTY_FORM: DeviceForm = {
  name: '',
  storeName: '',
  location: '',
  status: 'active'
};

const SYNC_STATUS: Record<SyncStatus, { label: string; tone: Tone }> = {
  local: { label: 'Local only', tone: 'neutral' },
  pending: { label: 'Pending', tone: 'warning' },
  synced: { label: 'Synced', tone: 'success' },
  error: { label: 'Failed', tone: 'danger' }
};

function formFromDevice(device: DeviceRecord): DeviceForm {
  return {
    name: device.name,
    storeName: device.storeName,
    location: device.location,
    status: device.status
  };
}

/** "interrupted" becomes "Interrupted"; status values read as sentence case. */
function sentenceCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function CopyButton(props: { value: string; label: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      className={`admin-btn admin-btn--ghost admin-btn--sm admin-btn--icon device-copy-button${copied ? ' is-copied' : ''}`}
      type="button"
      disabled={!props.value}
      aria-label={copied ? 'Copied' : props.label}
      title={copied ? 'Copied' : props.label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(props.value);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </button>
  );
}

/** The Device page: this device's key figures, details form, identity and cloud sync. */
export function DeviceManager(props: {
  onDeviceChanged: (device: DeviceRecord) => void;
  /** Main admin PIN gate, used by Rejoin in the Cloud sync section. */
  owner?: OwnerSession;
}): JSX.Element {
  const [summary, setSummary] = useState<DeviceManagerSummary | null>(null);
  const [form, setForm] = useState<DeviceForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // While this device must rejoin All devices, Rejoin is the page's one primary action.
  const [rejoinPending, setRejoinPending] = useState(false);
  const handleSyncStatus = useCallback((status: FleetSyncStatus): void => {
    setRejoinPending(status.removedByOwner || status.needsRejoin);
  }, []);

  const loadDevice = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const next = await window.nxgs.getCurrentDevice();
      setSummary(next);
      setForm(formFromDevice(next.device));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDevice();
  }, [loadDevice]);

  // After a sync the main admin's edits may have reached this device: refresh the
  // summary, and the form too unless someone is mid-edit.
  const summaryRef = useRef(summary);
  summaryRef.current = summary;
  const refreshAfterSync = useCallback(async (): Promise<void> => {
    try {
      const previous = summaryRef.current;
      const next = await window.nxgs.getCurrentDevice();
      const saved = previous ? formFromDevice(previous.device) : null;
      setForm((current) => (
        saved && (Object.keys(saved) as Array<keyof DeviceForm>).every((key) => current[key] === saved[key])
          ? formFromDevice(next.device)
          : current
      ));
      setSummary(next);
    } catch {
      // The sync section already reports sync problems.
    }
  }, []);

  const update = <K extends keyof DeviceForm>(key: K, value: DeviceForm[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const saveDevice = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const input: DeviceInput = form;
      const next = await window.nxgs.updateCurrentDevice(input);
      setSummary(next);
      setForm(formFromDevice(next.device));
      props.onDeviceChanged(next.device);
      setMessage('Device details saved. Games and device plans stay linked to this device ID.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingState label="Loading device..." />;
  }

  const device = summary?.device;
  const active = (device?.status ?? 'active') === 'active';
  const place = [device?.storeName, device?.location].filter(Boolean).join(' · ');
  const syncStatus = SYNC_STATUS[device?.syncStatus ?? 'pending'] ?? SYNC_STATUS.pending;
  const lastSynced = device?.lastSyncedAt ?? device?.syncedAt;

  return (
    <div className="device-page admin-stack">
      <StatRow aria-label="This device" minCellWidth={150}>
        <Stat label="Games on device" value={summary?.gameCount ?? 0} />
        <Stat label="Active plans" value={summary?.activePlanCount ?? 0} />
        <Stat label="Paid sessions" value={(summary?.totalSessions ?? 0).toLocaleString('en-IN')} />
        <Stat label="Revenue" value={formatPaise(summary?.totalRevenuePaise ?? 0)} />
      </StatRow>

      <div className="admin-split device-layout">
        <div className="admin-stack">
          <PageSection
            title="Edit details"
            description="Name this device and record where it is."
            className="device-editor-panel"
          >
            <Panel
              as="form"
              className="admin-form device-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveDevice();
              }}
            >
              <div className="form-grid">
                <Field label="Device name" required>
                  <input
                    value={form.name}
                    maxLength={80}
                    placeholder="Station 01"
                    disabled={saving}
                    onChange={(event) => update('name', event.target.value)}
                  />
                </Field>
                <Field label="Device status">
                  <select
                    value={form.status}
                    disabled={saving}
                    onChange={(event) => update('status', event.target.value as DeviceStatus)}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </Field>
                <Field label="Store / branch name">
                  <input
                    value={form.storeName}
                    maxLength={120}
                    placeholder="Main Store"
                    disabled={saving}
                    onChange={(event) => update('storeName', event.target.value)}
                  />
                </Field>
                <Field label="Device location">
                  <input
                    value={form.location}
                    maxLength={160}
                    placeholder="Front Desk / Cabin 1 / Room 2"
                    disabled={saving}
                    onChange={(event) => update('location', event.target.value)}
                  />
                </Field>
              </div>
              <footer className="admin-panel-footer">
                {message && <Notice tone="success">{message}</Notice>}
                {error && <Notice tone="error">{error}</Notice>}
                <button className={rejoinPending ? 'admin-btn' : 'admin-btn admin-btn--primary'} type="submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Save device'}
                </button>
              </footer>
            </Panel>
          </PageSection>

          <FleetSyncCard
            owner={props.owner}
            className="device-sync-panel"
            onSynced={() => void refreshAfterSync()}
            onStatusChange={handleSyncStatus}
          />
        </div>

        <PageSection
          title={device?.name || 'Current device'}
          description={place || 'Store and location not set'}
          className="device-overview-panel"
        >
          <dl className="admin-meta-list device-facts">
            <div>
              <dt>Device ID</dt>
              <dd className="device-id-value">
                <code className="admin-mono">{device?.id}</code>
                <CopyButton value={device?.id ?? ''} label="Copy device ID" />
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd><StatusText tone={active ? 'success' : 'neutral'}>{active ? 'Active' : 'Inactive'}</StatusText></dd>
            </div>
            <div><dt>Last updated</dt><dd>{dateTimeLabel(device?.updatedAt) || 'Never'}</dd></div>
            <div><dt>Last synced</dt><dd>{lastSynced ? dateTimeLabel(lastSynced) : 'Not synced yet'}</dd></div>
            <div>
              <dt>Sync status</dt>
              <dd><StatusText tone={syncStatus.tone}>{syncStatus.label}</StatusText></dd>
            </div>
            <div><dt>Current session</dt><dd>{sentenceCase(summary?.currentSessionStatus ?? 'idle')}</dd></div>
          </dl>
          <p className="admin-caption device-id-note">
            The device ID never changes. It links local games, plans, sessions, and future cloud records.
          </p>
        </PageSection>
      </div>
    </div>
  );
}
