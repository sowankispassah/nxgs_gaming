import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  LoaderCircle,
  MapPin,
  ReceiptIndianRupee,
  RefreshCw,
  Trash2
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
import {
  Badge,
  EmptyState,
  Field,
  InlineSwitch,
  LoadingState,
  Notice,
  PageActions,
  PageSection,
  Panel,
  Stat,
  StatRow,
  StatusText,
  type NoticeTone
} from './AdminKit';
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

function gameAvailability(game: FleetStationGame): { label: string; tone: 'danger' | 'neutral' } | null {
  if (game.availabilityStatus === 'missing') return { label: 'Missing', tone: 'danger' };
  if (game.availabilityStatus === 'unknown') return { label: 'Not checked', tone: 'neutral' };
  return null;
}

/** One device as the main admin sees it: figures, facts, games, details, moderators and removal. */
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
    <div className="fleet-detail">
      <PageActions>
        <button className="admin-btn" type="button" disabled={loading} onClick={() => void loadDetail()}>
          {loading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
          Refresh
        </button>
      </PageActions>

      <button className="admin-btn admin-btn--ghost admin-btn--sm fleet-back" type="button" onClick={props.onBack}>
        <ArrowLeft size={14} />
        All devices
      </button>

      {loadError && <Notice tone="error">{loadError}</Notice>}
      {!station && loading && <LoadingState label="Loading device..." />}

      {station && (
        <>
          <header className="fleet-detail-header">
            <div className="fleet-detail-heading">
              <h2 className="fleet-detail-title">
                <span>{station.name || 'Unnamed device'}</span>
                {station.isCurrentDevice && <Badge>This device</Badge>}
              </h2>
              <p className="fleet-detail-meta">
                {removed ? (
                  <StatusText tone="danger">Removed</StatusText>
                ) : (
                  <StatusText tone={station.status === 'active' ? 'success' : 'neutral'}>
                    {station.status === 'active' ? 'Active' : 'Inactive'}
                  </StatusText>
                )}
                <span className="fleet-detail-place">{place || 'Store and location not set'}</span>
              </p>
            </div>
            <button className="admin-btn admin-btn--sm" type="button" onClick={() => props.onViewEarnings(stationId)}>
              <ReceiptIndianRupee size={14} />
              View earnings
            </button>
          </header>

          {removed && (
            <Notice tone="warning">
              Removed {dateTimeLabel(station.removedAt)}. Its history stays in Accounts. It stops syncing until it rejoins from its own Device page.
            </Notice>
          )}

          <StatRow aria-label="Device figures" minCellWidth={150}>
            <Stat label="Games on device" value={station.gameCount.toLocaleString('en-IN')} />
            <Stat label="Paid sessions" value={station.sessionCount.toLocaleString('en-IN')} />
            <Stat label="Revenue" value={formatPaise(station.totalRevenuePaise)} />
          </StatRow>

          <div className="admin-split fleet-detail-layout">
            <div className="admin-stack">
              <PageSection
                title="Games on this device"
                description="Turn a game off to hide it from customers on this device."
                className="fleet-games"
                actions={detail && games.length > 0 && <span className="admin-count">{enabledCount} of {games.length} on</span>}
              >
                {gameError && <Notice tone="error">{gameError}</Notice>}
                {!detail && loading && <LoadingState label="Loading games..." />}
                {detail && games.length === 0 && (
                  <EmptyState title="No games synced">
                    Games added on this device appear here after it syncs.
                  </EmptyState>
                )}
                {games.length > 0 && (
                  <div className="admin-table-scroll fleet-games-scroll">
                    <table className="admin-table fleet-games-table">
                      <thead>
                        <tr>
                          <th scope="col">Game</th>
                          <th scope="col">Source</th>
                          <th scope="col">Status</th>
                          <th scope="col" className="fleet-games-switch-cell">On</th>
                        </tr>
                      </thead>
                      <tbody>
                        {games.map((game) => {
                          const availability = gameAvailability(game);
                          const busy = gameBusyId === game.id;
                          const disabled = removed || busy;
                          return (
                            <tr key={game.id} className={game.enabled ? undefined : 'is-off'}>
                              <td className="fleet-game-title">{game.title}</td>
                              <td className="fleet-cell-muted">{gameSourceLabel(game)}</td>
                              <td>
                                {game.pendingOwnerChange || availability ? (
                                  <span className="fleet-game-status">
                                    {game.pendingOwnerChange && (
                                      <StatusText tone="warning" title="The device applies this at its next sync">Waiting for device</StatusText>
                                    )}
                                    {availability && <StatusText tone={availability.tone}>{availability.label}</StatusText>}
                                  </span>
                                ) : (
                                  <span className="fleet-cell-empty">—</span>
                                )}
                              </td>
                              <td className="fleet-games-switch-cell">
                                <span className="fleet-game-switch-wrap">
                                  {busy && <LoaderCircle className="spin" size={14} aria-hidden="true" />}
                                  <InlineSwitch
                                    checked={game.enabled}
                                    disabled={disabled}
                                    aria-label={`${game.title} ${game.enabled ? 'on' : 'off'}`}
                                    onChange={(checked) => void setGameEnabled(game, checked)}
                                  />
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </PageSection>

              <PageSection
                title="Device details"
                description={station.isCurrentDevice ? 'Changes apply to this device right away.' : 'The device picks up changes at its next sync.'}
                className="fleet-edit"
              >
                {form && (
                  <Panel
                    as="form"
                    className="admin-form fleet-edit-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveDetails();
                    }}
                  >
                    <div className="form-grid">
                      <Field label="Device name" required>
                        <input
                          value={form.name}
                          maxLength={80}
                          placeholder="Station 01"
                          disabled={saving || removed}
                          onChange={(event) => update('name', event.target.value)}
                        />
                      </Field>
                      <Field label="Device status">
                        <select
                          value={form.status}
                          disabled={saving || removed}
                          onChange={(event) => update('status', event.target.value as DeviceStatus)}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </Field>
                      <Field label="Store / branch name">
                        <span className="admin-affix-input">
                          <Building2 size={15} aria-hidden="true" />
                          <input
                            value={form.storeName}
                            maxLength={120}
                            placeholder="Main Store"
                            disabled={saving || removed}
                            onChange={(event) => update('storeName', event.target.value)}
                          />
                        </span>
                      </Field>
                      <Field label="Device location">
                        <span className="admin-affix-input">
                          <MapPin size={15} aria-hidden="true" />
                          <input
                            value={form.location}
                            maxLength={160}
                            placeholder="Front Desk / Cabin 1 / Room 2"
                            disabled={saving || removed}
                            onChange={(event) => update('location', event.target.value)}
                          />
                        </span>
                      </Field>
                    </div>
                    <footer className="admin-panel-footer">
                      {formNotice && <Notice tone={formNotice.tone}>{formNotice.text}</Notice>}
                      <button className="admin-btn admin-btn--primary" type="submit" disabled={saving || removed}>
                        {saving && <LoaderCircle className="spin" size={15} />}
                        {saving ? 'Saving...' : 'Save device'}
                      </button>
                    </footer>
                  </Panel>
                )}
              </PageSection>

              {!removed && (
                // The same danger zone as Kiosk: a red-hairline panel, the action as a row, a two-step button.
                <PageSection title="Danger zone" className="fleet-remove">
                  {station.isCurrentDevice && (
                    <Notice tone="warning">This is the device you are using now.</Notice>
                  )}
                  {removeError && <Notice tone="error">{removeError}</Notice>}
                  <Panel padding="rows" className="admin-danger-zone">
                    <div className="admin-value-row">
                      <span className="admin-switch-copy">
                        <strong>
                          {confirmRemove ? <>Remove {station.name || 'this device'} from All devices?</> : 'Remove device'}
                        </strong>
                        <small>
                          Sessions and earnings stay in Accounts. The device stops syncing and its moderators lose access until it
                          rejoins from its own Device page.
                        </small>
                      </span>
                      <span className="admin-row-actions">
                        {confirmRemove ? (
                          <>
                            <button className="admin-btn" type="button" disabled={removing} onClick={() => setConfirmRemove(false)}>
                              Cancel
                            </button>
                            <button className="admin-btn admin-btn--danger confirming" type="button" disabled={removing} onClick={() => void removeDevice()}>
                              {removing ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
                              {removing ? 'Removing...' : 'Remove device'}
                            </button>
                          </>
                        ) : (
                          <button className="admin-btn admin-btn--danger" type="button" onClick={() => setConfirmRemove(true)}>
                            <Trash2 size={15} />
                            Remove device
                          </button>
                        )}
                      </span>
                    </div>
                  </Panel>
                </PageSection>
              )}
            </div>

            <div className="admin-stack fleet-detail-side">
              <PageSection title="Device" className="fleet-facts">
                <dl className="admin-meta-list">
                  <div><dt>Device ID</dt><dd><code className="admin-mono fleet-code">{station.id}</code></dd></div>
                  <div><dt>App version</dt><dd>{station.appVersion || 'Unknown'}</dd></div>
                  <div>
                    <dt>Last seen</dt>
                    <dd title={station.lastSeenAt ? dateTimeLabel(station.lastSeenAt) : undefined}>
                      {station.lastSeenAt ? relativeTime(station.lastSeenAt) : 'Never'}
                    </dd>
                  </div>
                  <div><dt>Joined</dt><dd>{dateTimeLabel(station.registeredAt) || 'Unknown'}</dd></div>
                  {removed && <div><dt>Removed</dt><dd>{dateTimeLabel(station.removedAt)}</dd></div>}
                </dl>
              </PageSection>

              <PageSection
                title="Moderators"
                description="People whose PIN unlocks the Control Room on this device."
                className="fleet-assigned"
              >
                {assigned.length === 0 ? (
                  <p className="admin-field-help">No moderators for this device. Only its own admin PIN unlocks it.</p>
                ) : (
                  <ul className="fleet-assigned-list">
                    {assigned.map((moderator) => (
                      <li key={moderator.id}>
                        <span className="fleet-assigned-name">{moderator.name}</span>
                        <StatusText tone={moderator.active ? 'success' : 'neutral'}>{moderator.active ? 'Active' : 'Inactive'}</StatusText>
                      </li>
                    ))}
                  </ul>
                )}
                <div>
                  <button className="admin-btn admin-btn--sm" type="button" onClick={props.onManageModerators}>
                    Manage moderators
                  </button>
                </div>
              </PageSection>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
