import { useCallback, useEffect, useState } from 'react';
import { Activity, Building2, Gamepad2, IndianRupee, LoaderCircle, MapPin, MonitorCog, Save, Timer } from 'lucide-react';
import type { DeviceInput, DeviceManagerSummary, DeviceRecord, DeviceStatus } from '../../shared/types';

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

export function DeviceManager(props: { onDeviceChanged: (device: DeviceRecord) => void }): JSX.Element {
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
    return <div className="panel admin-loading"><LoaderCircle className="spin" /> Loading device...</div>;
  }

  return (
    <div className="device-manager-grid">
      <section className="panel device-editor-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">This installation</p>
            <h2>Device Manager</h2>
          </div>
          <span className={`device-status-pill ${summary?.device.status ?? 'active'}`}>
            {summary?.device.status ?? 'active'}
          </span>
        </div>

        <form
          className="form-grid single"
          onSubmit={(event) => {
            event.preventDefault();
            void saveDevice();
          }}
        >
          <label>
            Device name <em className="required-badge">Required</em>
            <input
              value={form.name}
              maxLength={80}
              placeholder="PC 01"
              disabled={saving}
              onChange={(event) => update('name', event.target.value)}
            />
          </label>
          <label>
            Store / branch name
            <span className="device-field-with-icon">
              <Building2 size={17} />
              <input
                value={form.storeName}
                maxLength={120}
                placeholder="Main Store"
                disabled={saving}
                onChange={(event) => update('storeName', event.target.value)}
              />
            </span>
          </label>
          <label>
            Device location
            <span className="device-field-with-icon">
              <MapPin size={17} />
              <input
                value={form.location}
                maxLength={160}
                placeholder="Front Desk / Cabin 1 / Room 2"
                disabled={saving}
                onChange={(event) => update('location', event.target.value)}
              />
            </span>
          </label>
          <label>
            Device status
            <select
              value={form.status}
              disabled={saving}
              onChange={(event) => update('status', event.target.value as DeviceStatus)}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <button className="primary-action wide" type="submit" disabled={saving}>
            {saving ? <LoaderCircle className="spin" size={19} /> : <Save size={19} />}
            {saving ? 'Saving...' : 'Save Device'}
          </button>
        </form>
        {message && <p className="success-text" role="status">{message}</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
      </section>

      <section className="panel device-overview-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Local identity</p>
            <h2>{summary?.device.name ?? 'Current device'}</h2>
          </div>
          <MonitorCog size={28} />
        </div>

        <div className="device-id-card">
          <span>Generated device ID</span>
          <code>{summary?.device.id}</code>
          <small>This stable ID links local games, plans, sessions, and future cloud records.</small>
        </div>

        <div className="device-stat-grid">
          <article>
            <Gamepad2 size={21} />
            <span>Games on device</span>
            <strong>{summary?.gameCount ?? 0}</strong>
          </article>
          <article>
            <Timer size={21} />
            <span>Active plans</span>
            <strong>{summary?.activePlanCount ?? 0}</strong>
          </article>
          <article>
            <Activity size={21} />
            <span>Total sessions</span>
            <strong>{summary?.totalSessions ?? 0}</strong>
          </article>
          <article>
            <IndianRupee size={21} />
            <span>Tracked revenue</span>
            <strong>₹{((summary?.totalRevenuePaise ?? 0) / 100).toLocaleString('en-IN')}</strong>
          </article>
        </div>

        <dl className="device-metadata-list">
          <div><dt>Store / branch</dt><dd>{summary?.device.storeName || 'Not set'}</dd></div>
          <div><dt>Location</dt><dd>{summary?.device.location || 'Not set'}</dd></div>
          <div><dt>Last updated</dt><dd>{dateTimeLabel(summary?.device.updatedAt)}</dd></div>
          <div><dt>Last synced</dt><dd>{dateTimeLabel(summary?.device.lastSyncedAt ?? summary?.device.syncedAt)}</dd></div>
          <div><dt>Sync status</dt><dd>{summary?.device.syncStatus ?? 'pending'}</dd></div>
          <div><dt>Current session</dt><dd>{summary?.currentSessionStatus ?? 'idle'}</dd></div>
        </dl>
      </section>
    </div>
  );
}
