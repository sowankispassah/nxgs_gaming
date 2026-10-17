import { useRef, useState } from 'react';
import { LoaderCircle, Pencil, Plus, Save, Trash2, UserPlus, Users } from 'lucide-react';
import type { FleetStation, ModeratorInput, ModeratorRecord } from '../../../shared/types';
import { CardHeader, EmptyState, LoadingState, Notice, revealInContent, SwitchRow, type NoticeTone } from './AdminKit';
import { PIN_PATTERN } from './fleetFormat';
import type { OwnerSession } from './useOwnerSession';

type ModeratorForm = {
  id?: string;
  name: string;
  pin: string;
  confirmPin: string;
  active: boolean;
  stationIds: string[];
};

const EMPTY_FORM: ModeratorForm = {
  name: '',
  pin: '',
  confirmPin: '',
  active: true,
  stationIds: []
};

function formFromModerator(moderator: ModeratorRecord): ModeratorForm {
  return {
    id: moderator.id,
    name: moderator.name,
    pin: '',
    confirmPin: '',
    active: moderator.active,
    stationIds: [...moderator.stationIds]
  };
}

function sortModerators(moderators: ModeratorRecord[]): ModeratorRecord[] {
  return [...moderators].sort((left, right) => left.name.localeCompare(right.name));
}

/** Moderators: people whose own PIN unlocks the Control Room on the devices they are given. */
export function ModeratorsSection(props: {
  owner: OwnerSession;
  stations: FleetStation[];
  /** The device list loaded successfully; saving waits for it so assignments are never guessed. */
  stationsReady: boolean;
  /** Why the device list did not load, if it failed. */
  stationsError: string;
  moderators: ModeratorRecord[] | null;
  loadError: string;
  loading: boolean;
  onModeratorsChanged: (moderators: ModeratorRecord[]) => void;
}): JSX.Element {
  const [form, setForm] = useState<ModeratorForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState('');
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [listError, setListError] = useState('');
  const editorRef = useRef<HTMLElement>(null);
  const moderators = props.moderators ?? [];
  const assignable = props.stations.filter((station) => !station.removedAt);
  const stationName = (id: string): string => props.stations.find((station) => station.id === id)?.name ?? 'Unknown device';
  // Assigned ids the device list does not know (yet): kept as they are, never dropped silently.
  const savedIds = form.id ? moderators.find((moderator) => moderator.id === form.id)?.stationIds ?? [] : [];
  const unknownAssigned = props.stationsReady
    ? [...new Set([...savedIds, ...form.stationIds])].filter((id) => !props.stations.some((station) => station.id === id))
    : [];
  const busy = saving || Boolean(busyId);

  const update = <K extends keyof ModeratorForm>(key: K, value: ModeratorForm[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const toggleStation = (stationId: string, checked: boolean): void => {
    setForm((current) => ({
      ...current,
      stationIds: checked
        ? [...new Set([...current.stationIds, stationId])]
        : current.stationIds.filter((id) => id !== stationId)
    }));
  };

  const editModerator = (moderator: ModeratorRecord): void => {
    setForm(formFromModerator(moderator));
    setNotice(null);
    setConfirmDeleteId('');
    revealInContent(editorRef.current);
  };

  const saveModerator = async (): Promise<void> => {
    if (busy || !props.stationsReady) return;
    const name = form.name.trim();
    if (!name) {
      setNotice({ tone: 'error', text: 'Enter the moderator\'s name.' });
      return;
    }
    if (!form.id || form.pin || form.confirmPin) {
      if (!PIN_PATTERN.test(form.pin)) {
        setNotice({ tone: 'error', text: 'The PIN must be 4 to 12 digits.' });
        return;
      }
      if (form.pin !== form.confirmPin) {
        setNotice({ tone: 'error', text: 'The PIN and the confirmation do not match.' });
        return;
      }
    }
    const input: ModeratorInput = {
      id: form.id,
      name,
      pin: form.pin || undefined,
      // Only drop devices known to be removed (the cloud rejects those); keep everything else.
      stationIds: form.stationIds.filter((id) => !props.stations.some((station) => station.id === id && station.removedAt)),
      active: form.active
    };
    setSaving(true);
    setNotice(null);
    try {
      const result = await props.owner.run(() => window.nxgs.saveModerator(input));
      if (result.ok && result.data) {
        const saved = result.data;
        props.onModeratorsChanged(sortModerators([...moderators.filter((moderator) => moderator.id !== saved.id), saved]));
        setForm(formFromModerator(saved));
        setNotice({
          tone: 'success',
          text: `${form.id ? 'Moderator updated.' : 'Moderator added.'} Devices pick up the change at their next sync.`
        });
      } else if (result.code !== 'owner_pin_required') {
        setNotice({ tone: 'error', text: result.error ?? 'Could not save the moderator.' });
      }
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  };

  const deleteModerator = async (moderator: ModeratorRecord): Promise<void> => {
    if (busy) return;
    if (confirmDeleteId !== moderator.id) {
      setConfirmDeleteId(moderator.id);
      return;
    }
    setBusyId(moderator.id);
    setListError('');
    try {
      const result = await props.owner.run(() => window.nxgs.deleteModerator(moderator.id));
      if (result.ok) {
        props.onModeratorsChanged(moderators.filter((item) => item.id !== moderator.id));
        if (form.id === moderator.id) setForm(EMPTY_FORM);
        setConfirmDeleteId('');
      } else if (result.code !== 'owner_pin_required') {
        setListError(result.error ?? 'Could not delete the moderator.');
      }
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="admin-columns admin-columns--plans fleet-moderators-grid">
      <section className="admin-card fleet-moderator-list-card">
        <CardHeader
          eyebrow="Access"
          title="Moderators"
          subtitle="A moderator's PIN unlocks the Control Room on the devices you pick."
          icon={<Users size={20} />}
          actions={props.moderators && <span className="ps-chip admin-count-chip">{moderators.length} saved</span>}
        />
        {props.loadError && <Notice tone="error" className="fleet-list-notice">{props.loadError}</Notice>}
        {listError && <Notice tone="error" className="fleet-list-notice">{listError}</Notice>}
        {!props.moderators && props.loading && <LoadingState label="Loading moderators..." />}
        {props.moderators && moderators.length === 0 && (
          <EmptyState icon={<UserPlus size={28} />} title="No moderators yet">
            Add staff who should unlock the Control Room with their own PIN.
          </EmptyState>
        )}
        {moderators.length > 0 && (
          <ul className="fleet-moderator-list">
            {moderators.map((moderator) => {
              const editing = form.id === moderator.id;
              const confirming = confirmDeleteId === moderator.id;
              const deleting = busyId === moderator.id;
              const deviceNames = moderator.stationIds.map(stationName);
              return (
                <li key={moderator.id} className={`fleet-moderator-row${editing ? ' selected' : ''}${moderator.active ? '' : ' is-inactive'}`}>
                  <button className="fleet-moderator-summary" type="button" aria-current={editing ? 'true' : undefined} onClick={() => editModerator(moderator)}>
                    <strong>{moderator.name}</strong>
                    <span title={deviceNames.join(', ')}>
                      {deviceNames.length === 0 ? 'No devices' : deviceNames.join(', ')}
                    </span>
                  </button>
                  <span className={`ps-chip ${moderator.active ? 'ps-chip--success' : ''}`}>{moderator.active ? 'Active' : 'Inactive'}</span>
                  <div className="fleet-moderator-actions">
                    <button className="secondary-action compact" type="button" disabled={busy} onClick={() => editModerator(moderator)}>
                      <Pencil size={15} /> Edit
                    </button>
                    <button
                      className={`secondary-action compact danger${confirming ? ' confirming' : ''}`}
                      type="button"
                      disabled={busy}
                      onClick={() => void deleteModerator(moderator)}
                    >
                      {deleting ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
                      {deleting ? 'Deleting...' : confirming ? 'Confirm' : 'Delete'}
                    </button>
                    {confirming && !deleting && (
                      <button className="secondary-action compact" type="button" disabled={busy} onClick={() => setConfirmDeleteId('')}>
                        Cancel
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="admin-card fleet-moderator-editor" ref={editorRef}>
        <CardHeader
          eyebrow="Moderator"
          title={form.id ? 'Edit Moderator' : 'Add Moderator'}
          subtitle={form.id ? 'Changes reach each device at its next sync.' : 'Give a staff member their own Control Room PIN.'}
          actions={form.id && (
            <button
              className="secondary-action compact"
              type="button"
              disabled={busy}
              onClick={() => {
                setForm(EMPTY_FORM);
                setNotice(null);
              }}
            >
              <Plus size={16} />
              New
            </button>
          )}
        />
        <form
          className="admin-form fleet-moderator-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveModerator();
          }}
        >
          <label className="admin-field">
            <span className="admin-field-label">
              Name <em className="required-badge">Required</em>
            </span>
            <input
              value={form.name}
              maxLength={60}
              placeholder="Staff name"
              disabled={saving}
              onChange={(event) => update('name', event.target.value)}
            />
          </label>
          <div className="form-grid">
            <label className="admin-field">
              <span className="admin-field-label">
                PIN {!form.id && <em className="required-badge">Required</em>}
              </span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={12}
                value={form.pin}
                disabled={saving}
                onChange={(event) => update('pin', event.target.value.replace(/\D/g, ''))}
              />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Confirm PIN</span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={12}
                value={form.confirmPin}
                disabled={saving}
                onChange={(event) => update('confirmPin', event.target.value.replace(/\D/g, ''))}
              />
            </label>
          </div>
          <small className="field-note">
            {form.id ? 'Leave blank to keep the current PIN. ' : ''}4 to 12 digits. Use a PIN different from every device's admin PIN.
          </small>
          <SwitchRow
            label="Active"
            description="Inactive moderators can't unlock any device."
            checked={form.active}
            disabled={saving}
            onChange={(checked) => update('active', checked)}
          />
          <fieldset className="fleet-device-picker" disabled={saving}>
            <legend className="admin-section-title">Devices this moderator can unlock</legend>
            {!props.stationsReady ? (
              <p className="field-note">{props.stationsError ? 'The device list did not load.' : 'Loading devices...'}</p>
            ) : assignable.length === 0 && unknownAssigned.length === 0 ? (
              <p className="field-note">No devices yet.</p>
            ) : (
              assignable.map((station) => (
                <label key={station.id} className="fleet-device-option">
                  <input
                    type="checkbox"
                    checked={form.stationIds.includes(station.id)}
                    onChange={(event) => toggleStation(station.id, event.target.checked)}
                  />
                  <span>
                    <strong>{station.name || 'Unnamed device'}</strong>
                    <small>{[station.storeName, station.location].filter(Boolean).join(' · ') || 'Store and location not set'}</small>
                  </span>
                  {station.isCurrentDevice && <span className="ps-chip ps-chip--accent">This device</span>}
                </label>
              ))
            )}
            {unknownAssigned.map((id) => (
              <label key={id} className="fleet-device-option">
                <input
                  type="checkbox"
                  checked={form.stationIds.includes(id)}
                  onChange={(event) => toggleStation(id, event.target.checked)}
                />
                <span>
                  <strong>Unknown device</strong>
                  <small>{id}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <footer className="admin-card-footer admin-card-footer--stacked">
            {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
            {!props.stationsReady && props.stationsError && (
              <Notice tone="error">Moderators can be saved once the device list loads. {props.stationsError}</Notice>
            )}
            <button className="primary-action wide" type="submit" disabled={busy || !props.stationsReady}>
              {saving ? <LoaderCircle className="spin" size={19} /> : <Save size={19} />}
              {saving ? 'Saving...' : form.id ? 'Update Moderator' : 'Add Moderator'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
