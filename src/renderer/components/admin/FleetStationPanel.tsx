import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Building2,
  Gamepad2,
  Hourglass,
  IndianRupee,
  LoaderCircle,
  MapPin,
  ReceiptIndianRupee,
  RefreshCw,
  Save,
  Trash2,
  TriangleAlert,
  Users
} from 'lucide-react';
import type {
  DeviceStatus,
  FleetStation,
  FleetStationDetail,
  FleetStationGame,
  FleetStationInput,
  LaunchType,
  ModeratorRecord
} from '../../../shared/types';
import { CardHeader, EmptyState, LoadingState, Notice, type NoticeTone } from './AdminKit';
import { dateTimeLabel, formatPaise, relativeTime } from './fleetFormat';
import type { OwnerSession } from './useOwnerSession';

const LAUNCH_TYPE_LABELS: Record<LaunchType, string> = {
  steam: 'Steam',
  epic: 'Epic Games',
  microsoftStore: 'Microsoft Store',
  localExe: 'Local game',
  custom: 'Custom'
};

function formFromStation(station: FleetStation): FleetStationInput {
  return {
    name: station.name,
    storeName: station.storeName,
    location: station.location,
    status: station.status
  };
}

/** "Steam", or "Custom · Riot": the launcher type and where the game came from, without repeating one. */
function gameSourceLabel(game: FleetStationGame): string {
  const type = LAUNCH_TYPE_LABELS[game.launchType] ?? game.launchType;
  const source = game.source?.trim();
  return !source || source.toLowerCase() === type.toLowerCase() ? type : `${type} · ${source}`;
}

function gameAvailability(game: FleetStationGame): { label: string; tone: string } | null {
  if (game.availabilityStatus === 'missing') return { label: 'Missing', tone: 'ps-chip--danger' };
  if (game.availabilityStatus === 'unknown') return { label: 'Not checked', tone: '' };
  return null;
}

/** One device as the main admin sees it: details, games, moderators and removal. */
export function FleetStationPanel(props: {
  stationId: string;
  /** The list entry, shown while the full detail loads. */
  summary?: FleetStation;
  /** Every moderator, when loaded; falls back to the detail's own list. */
  moderators: ModeratorRecord[] | null;
  owner: OwnerSession;
  onBack: () => void;
  onStationChanged: (station: FleetStation) => void;
  onRemoved: (stationId: string) => void;
  onViewEarnings: (stationId: string) => void;
  onManageModerators: () => void;
}): JSX.Element {
  const { owner, stationId, onStationChanged } = props;
  const onStationChangedRef = useRef(onStationChanged);
  onStationChangedRef.current = onStationChanged;
  const [detail, setDetail] = useState<FleetStationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<FleetStationInput | null>(props.summary ? formFromStation(props.summary) : null);
  const [saving, setSaving] = useState(false);
  const [formNotice, setFormNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [gameBusyId, setGameBusyId] = useState('');
  const [gameError, setGameError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');

  const loadDetail = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await owner.run(() => window.nxgs.getFleetStation(stationId));
      if (result.ok && result.data) {
        setDetail(result.data);
        setForm(formFromStation(result.data.station));
        onStationChangedRef.current(result.data.station);
      } else if (result.code !== 'owner_pin_required') {
        setLoadError(result.error ?? 'Could not load this device.');
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [owner.run, stationId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const station = detail?.station ?? props.summary;
  const removed = Boolean(station?.removedAt);
  const assigned = props.moderators
    ? props.moderators.filter((moderator) => moderator.stationIds.includes(stationId))
    : detail?.moderators ?? [];

  const update = <K extends keyof FleetStationInput>(key: K, value: FleetStationInput[K]): void => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  };

  const saveDetails = async (): Promise<void> => {
    if (!form || saving) return;
    const input: FleetStationInput = {
      name: form.name.trim(),
      storeName: form.storeName.trim(),
      location: form.location.trim(),
      status: form.status
    };
    if (!input.name) {
      setFormNotice({ tone: 'error', text: 'Enter a device name.' });
      return;
    }
    setSaving(true);
    setFormNotice(null);
    try {
      const result = await owner.run(() => window.nxgs.updateFleetStation(stationId, input));
      if (result.ok && result.data) {
        const saved = result.data;
        setDetail((current) => (current ? { ...current, station: saved } : current));
        setForm(formFromStation(saved));
        onStationChanged(saved);
        setFormNotice({
          tone: 'success',
          text: saved.isCurrentDevice ? 'Device details saved. This device updated right away.' : 'Device details saved. The device picks them up at its next sync.'
        });
      } else if (result.code !== 'owner_pin_required') {
        setFormNotice({ tone: 'error', text: result.error ?? 'Could not save the device details.' });
      }
    } catch (error) {
      setFormNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  };

  const setGameEnabled = async (game: FleetStationGame, enabled: boolean): Promise<void> => {
    if (gameBusyId) return;
    setGameBusyId(game.id);
    setGameError('');
    try {
      const result = await owner.run(() => window.nxgs.setFleetGameEnabled(stationId, game.id, enabled));
      if (result.ok && result.data) {
        const saved = result.data;
        setDetail((current) => current && {
          ...current,
          games: current.games.map((item) => (item.id === saved.id ? saved : item))
        });
      } else if (result.code !== 'owner_pin_required') {
        setGameError(result.error ?? 'Could not change this game.');
      }
    } catch (error) {
      setGameError(error instanceof Error ? error.message : String(error));
    } finally {
      setGameBusyId('');
    }
  };

  const removeDevice = async (): Promise<void> => {
    if (removing) return;
    setRemoving(true);
    setRemoveError('');
    try {
      const result = await owner.run(() => window.nxgs.removeFleetStation(stationId));
      if (result.ok) {
        props.onRemoved(stationId);
      } else if (result.code !== 'owner_pin_required') {
        setRemoveError(result.error ?? 'Could not remove this device.');
      }
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : String(error));
    } finally {
      setRemoving(false);
    }
  };

  const place = [station?.storeName, station?.location].filter(Boolean).join(' · ');
  const games = detail?.games ?? [];
  const enabledCount = games.filter((game) => game.enabled).length;

  return (
    <div className="fleet-detail admin-stack">
      <div className="fleet-detail-bar">
        <button className="secondary-action compact" type="button" onClick={props.onBack}>
          <ArrowLeft size={16} />
          All devices
        </button>
        <button className="secondary-action compact" type="button" disabled={loading} onClick={() => void loadDetail()}>
          {loading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
          Refresh
        </button>
      </div>

      {loadError && <Notice tone="error">{loadError}</Notice>}
      {!station && loading && (
        <section className="admin-card admin-loading-card">
          <LoadingState label="Loading device..." />
        </section>
      )}

      {station && (
        <div className="admin-columns fleet-detail-grid">
          <div className="admin-stack">
            <section className="admin-card fleet-overview-card">
              <CardHeader
                eyebrow={station.isCurrentDevice ? 'This device' : 'Device'}
                title={station.name || 'Unnamed device'}
                subtitle={place || 'Store and location not set'}
                actions={(
                  <button className="secondary-action compact" type="button" onClick={() => props.onViewEarnings(stationId)}>
                    <ReceiptIndianRupee size={15} />
                    View earnings
                  </button>
                )}
              />
              <div className="fleet-station-chips">
                {removed ? (
                  <span className="ps-chip ps-chip--danger">Removed</span>
                ) : (
                  <span className={`ps-chip device-status-pill ${station.status === 'active' ? 'ps-chip--success' : ''}`}>
                    {station.status === 'active' ? 'Active' : 'Inactive'}
                  </span>
                )}
                {station.isCurrentDevice && <span className="ps-chip ps-chip--accent">This device</span>}
              </div>
              {removed && (
                <Notice tone="warning" className="fleet-removed-notice">
                  Removed {dateTimeLabel(station.removedAt)}. Its history stays in Accounts. It stops syncing until it rejoins from its own Device Manager page.
                </Notice>
              )}
              <div className="device-stat-grid fleet-stat-grid">
                <article>
                  <span className="device-stat-icon" aria-hidden="true"><Gamepad2 size={20} /></span>
                  <strong>{station.gameCount}</strong>
                  <span>Games on device</span>
                </article>
                <article>
                  <span className="device-stat-icon" aria-hidden="true"><Activity size={20} /></span>
                  <strong>{station.sessionCount}</strong>
                  <span>Paid sessions</span>
                </article>
                <article>
                  <span className="device-stat-icon" aria-hidden="true"><IndianRupee size={20} /></span>
                  <strong>{formatPaise(station.totalRevenuePaise)}</strong>
                  <span>Revenue</span>
                </article>
              </div>
              <dl className="admin-meta-list fleet-meta-list">
                <div><dt>Device ID</dt><dd><code className="fleet-code">{station.id}</code></dd></div>
                <div><dt>App version</dt><dd>{station.appVersion ? `v${station.appVersion}` : 'Unknown'}</dd></div>
                <div><dt>Last seen</dt><dd>{station.lastSeenAt ? `${relativeTime(station.lastSeenAt)} · ${dateTimeLabel(station.lastSeenAt)}` : 'Never'}</dd></div>
                <div><dt>Joined</dt><dd>{dateTimeLabel(station.registeredAt) || 'Unknown'}</dd></div>
              </dl>
            </section>

            <section className="admin-card fleet-games-card">
              <CardHeader
                eyebrow="Games"
                title="Games on this device"
                subtitle="Turn a game off to hide it from customers on this device."
                actions={detail && <span className="ps-chip admin-count-chip">{enabledCount} of {games.length} on</span>}
              />
              {gameError && <Notice tone="error" className="fleet-games-notice">{gameError}</Notice>}
              {!detail && loading && <LoadingState label="Loading games..." />}
              {detail && games.length === 0 && (
                <EmptyState icon={<Gamepad2 size={28} />} title="No games synced">
                  Games added on this device appear here after it syncs.
                </EmptyState>
              )}
              {games.length > 0 && (
                <ul className="admin-switch-list fleet-game-list">
                  {games.map((game) => {
                    const availability = gameAvailability(game);
                    const busy = gameBusyId === game.id;
                    const disabled = removed || busy;
                    return (
                      <li key={game.id}>
                        <label className={`admin-switch-row fleet-game-row${removed ? ' is-disabled' : ''}`}>
                          <span className="admin-switch-copy">
                            <strong>{game.title}</strong>
                            <small>{gameSourceLabel(game)}</small>
                          </span>
                          <span className="fleet-game-side">
                            {game.pendingOwnerChange && (
                              <span className="ps-chip ps-chip--warning" title="The device applies this at its next sync">
                                <Hourglass size={13} aria-hidden="true" />
                                Waiting for device
                              </span>
                            )}
                            {availability && <span className={`ps-chip ${availability.tone}`}>{availability.label}</span>}
                            {busy && <LoaderCircle className="spin" size={17} aria-hidden="true" />}
                            <input
                              className="admin-switch-input"
                              type="checkbox"
                              checked={game.enabled}
                              disabled={disabled}
                              aria-label={`${game.title} ${game.enabled ? 'on' : 'off'}`}
                              onChange={(event) => void setGameEnabled(game, event.target.checked)}
                            />
                            <span className="ps-switch" data-on={game.enabled ? 'true' : 'false'} aria-hidden="true" />
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          <div className="admin-stack">
            <section className="admin-card fleet-edit-card">
              <CardHeader
                eyebrow="Details"
                title="Edit device"
                subtitle={station.isCurrentDevice ? 'Changes apply to this device right away.' : 'The device picks up changes at its next sync.'}
              />
              {form && (
                <form
                  className="admin-form device-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveDetails();
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
                      disabled={saving || removed}
                      onChange={(event) => update('name', event.target.value)}
                    />
                  </label>
                  <label className="admin-field">
                    <span className="admin-field-label">Store / branch</span>
                    <span className="admin-affix-input device-field-with-icon">
                      <Building2 size={17} aria-hidden="true" />
                      <input
                        value={form.storeName}
                        maxLength={120}
                        placeholder="Main Store"
                        disabled={saving || removed}
                        onChange={(event) => update('storeName', event.target.value)}
                      />
                    </span>
                  </label>
                  <label className="admin-field">
                    <span className="admin-field-label">Location</span>
                    <span className="admin-affix-input device-field-with-icon">
                      <MapPin size={17} aria-hidden="true" />
                      <input
                        value={form.location}
                        maxLength={160}
                        placeholder="Front Desk / Cabin 1"
                        disabled={saving || removed}
                        onChange={(event) => update('location', event.target.value)}
                      />
                    </span>
                  </label>
                  <label className="admin-field">
                    <span className="admin-field-label">Status</span>
                    <select
                      value={form.status}
                      disabled={saving || removed}
                      onChange={(event) => update('status', event.target.value as DeviceStatus)}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </label>
                  <footer className="admin-card-footer admin-card-footer--stacked">
                    {formNotice && <Notice tone={formNotice.tone}>{formNotice.text}</Notice>}
                    <button className="primary-action wide" type="submit" disabled={saving || removed}>
                      {saving ? <LoaderCircle className="spin" size={19} /> : <Save size={19} />}
                      {saving ? 'Saving...' : 'Save Device'}
                    </button>
                  </footer>
                </form>
              )}
            </section>

            <section className="admin-card fleet-assigned-card">
              <CardHeader
                eyebrow="Access"
                title="Moderators"
                subtitle="People whose PIN unlocks the Control Room on this device."
                icon={<Users size={20} />}
                actions={(
                  <button className="secondary-action compact" type="button" onClick={props.onManageModerators}>
                    Manage
                  </button>
                )}
              />
              {assigned.length === 0 ? (
                <p className="field-note">No moderators for this device. Only its own admin PIN unlocks it.</p>
              ) : (
                <ul className="fleet-assigned-list">
                  {assigned.map((moderator) => (
                    <li key={moderator.id}>
                      <strong>{moderator.name}</strong>
                      <span className={`ps-chip ${moderator.active ? 'ps-chip--success' : ''}`}>{moderator.active ? 'Active' : 'Inactive'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {!removed && (
              <section className="admin-card danger-zone fleet-remove-card">
                <CardHeader
                  eyebrow="Remove"
                  title="Remove device"
                  subtitle="Sessions and earnings stay in Accounts. The device stops syncing and its moderators lose access until it rejoins from its own Device Manager page."
                  icon={<Trash2 size={20} />}
                />
                {station.isCurrentDevice && (
                  <Notice tone="warning" className="fleet-remove-warning">
                    This is the device you are using now.
                  </Notice>
                )}
                {removeError && <Notice tone="error" className="fleet-remove-warning">{removeError}</Notice>}
                {confirmRemove ? (
                  <div className="fleet-remove-confirm">
                    <p>
                      <TriangleAlert size={17} aria-hidden="true" />
                      <span>Remove <strong>{station.name || 'this device'}</strong> from Device Management?</span>
                    </p>
                    <div className="fleet-remove-actions">
                      <button className="secondary-action" type="button" disabled={removing} onClick={() => setConfirmRemove(false)}>
                        Cancel
                      </button>
                      <button className="danger-action" type="button" disabled={removing} onClick={() => void removeDevice()}>
                        {removing ? <LoaderCircle className="spin" size={18} /> : <Trash2 size={18} />}
                        {removing ? 'Removing...' : 'Remove device'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="secondary-action compact danger" type="button" onClick={() => setConfirmRemove(true)}>
                    <Trash2 size={15} />
                    Remove device
                  </button>
                )}
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
