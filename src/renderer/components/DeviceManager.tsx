import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Building2,
  Check,
  Copy,
  Gamepad2,
  IndianRupee,
  LoaderCircle,
  MapPin,
  Save,
  Timer
} from 'lucide-react';
import type { DeviceInput, DeviceManagerSummary, DeviceRecord, DeviceStatus } from '../../shared/types';
import { CardHeader, LoadingState, Notice } from './admin/AdminKit';
import { FleetSyncCard } from './admin/FleetSyncCard';
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

function formFromDevice(device: DeviceRecord): DeviceForm {
  return {
    name: device.name,
    storeName: device.storeName,
    location: device.location,
    status: device.status
  };
}

function dateTimeLabel(value?: string): string {
  if (!value) return 'Not synced yet';
  return new Date(value).toLocaleString();
}

function CopyButton(props: { value: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      className="secondary-action compact device-copy-button"
      type="button"
      disabled={!props.value}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(props.value);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function DeviceManager(props: {
  onDeviceChanged: (device: DeviceRecord) => void;
  /** Main admin PIN gate, used by Rejoin in the Cloud sync card. */
  owner?: OwnerSession;
}): JSX.Element {
  const [summary, setSummary] = useState<DeviceManagerSummary | null>(null);
  const [form, setForm] = useState<DeviceForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

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
      // The sync card already reports sync problems.
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
      setMessage('Device settings saved. Games and device plans remain linked to this device ID.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="admin-card admin-loading-card">
        <LoadingState label="Loading device..." />
      </section>
    );
  }

  const device = summary?.device;
  const status = device?.status ?? 'active';
  const place = [device?.storeName, device?.location].filter(Boolean).join(' · ');

  return (
    <div className="admin-columns admin-columns--device device-manager-grid">
      <section className="admin-card device-overview-panel">
        <CardHeader
          eyebrow="Local identity"
          title={device?.name ?? 'Current device'}
          subtitle={place || 'Store and location not set'}
          actions={(
            <span className={`device-status-pill ps-chip ${status === 'active' ? 'ps-chip--success' : ''}`}>
              {status === 'active' ? 'Active' : 'Inactive'}
            </span>
          )}
        />

        <div className="device-id-card">
          <span className="device-id-label">Generated device ID</span>
          <div className="device-id-value">
            <code>{device?.id}</code>
            <CopyButton value={device?.id ?? ''} />
          </div>
          <small>This stable ID links local games, plans, sessions, and future cloud records.</small>
        </div>

        <div className="device-stat-grid">
          <article>
            <span className="device-stat-icon" aria-hidden="true"><Gamepad2 size={20} /></span>
            <strong>{summary?.gameCount ?? 0}</strong>
            <span>Games on device</span>
          </article>
          <article>
            <span className="device-stat-icon" aria-hidden="true"><Timer size={20} /></span>
            <strong>{summary?.activePlanCount ?? 0}</strong>
            <span>Active plans</span>
          </article>
          <article>
            <span className="device-stat-icon" aria-hidden="true"><Activity size={20} /></span>
            <strong>{summary?.totalSessions ?? 0}</strong>
            <span>Total sessions</span>
          </article>
          <article>
            <span className="device-stat-icon" aria-hidden="true"><IndianRupee size={20} /></span>
            <strong>₹{((summary?.totalRevenuePaise ?? 0) / 100).toLocaleString('en-IN')}</strong>
            <span>Tracked revenue</span>
          </article>
        </div>

        <dl className="admin-meta-list device-metadata-list">
          <div><dt>Store / branch</dt><dd>{device?.storeName || 'Not set'}</dd></div>
          <div><dt>Location</dt><dd>{device?.location || 'Not set'}</dd></div>
          <div><dt>Last updated</dt><dd>{dateTimeLabel(device?.updatedAt)}</dd></div>
          <div><dt>Last synced</dt><dd>{dateTimeLabel(device?.lastSyncedAt ?? device?.syncedAt)}</dd></div>
          <div><dt>Sync status</dt><dd className="admin-capitalize">{device?.syncStatus ?? 'pending'}</dd></div>
          <div><dt>Current session</dt><dd className="admin-capitalize">{summary?.currentSessionStatus ?? 'idle'}</dd></div>
        </dl>
      </section>

      <div className="admin-stack device-side-stack">
        <section className="admin-card device-editor-panel">
          <CardHeader
            eyebrow="This installation"
            title="Station details"
            subtitle="Name this station and record where it is."
          />

          <form
            className="admin-form device-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveDevice();
            }}
          >
            <label className="admin-field">
              <span className="admin-field-label">
                Device name <em className="required-badge">Required</em>
              </span>
              <input
                value={form.name}
                maxLength={80}
                placeholder="Station 01"
                disabled={saving}
                onChange={(event) => update('name', event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Store / branch name</span>
              <span className="admin-affix-input device-field-with-icon">
                <Building2 size={17} aria-hidden="true" />
                <input
                  value={form.storeName}
                  maxLength={120}
                  placeholder="Main Store"
                  disabled={saving}
                  onChange={(event) => update('storeName', event.target.value)}
                />
              </span>
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Device location</span>
              <span className="admin-affix-input device-field-with-icon">
                <MapPin size={17} aria-hidden="true" />
                <input
                  value={form.location}
                  maxLength={160}
                  placeholder="Front Desk / Cabin 1 / Room 2"
                  disabled={saving}
                  onChange={(event) => update('location', event.target.value)}
                />
              </span>
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Device status</span>
              <select
                value={form.status}
                disabled={saving}
                onChange={(event) => update('status', event.target.value as DeviceStatus)}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <footer className="admin-card-footer admin-card-footer--stacked">
              {message && <Notice tone="success">{message}</Notice>}
              {error && <Notice tone="error">{error}</Notice>}
              <button className="primary-action wide" type="submit" disabled={saving}>
                {saving ? <LoaderCircle className="spin" size={19} /> : <Save size={19} />}
                {saving ? 'Saving...' : 'Save Device'}
              </button>
            </footer>
          </form>
        </section>

        <FleetSyncCard owner={props.owner} className="device-sync-panel" onSynced={() => void refreshAfterSync()} />
      </div>
    </div>
  );
}
