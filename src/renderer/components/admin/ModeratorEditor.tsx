import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { FleetStation, ModeratorInput, ModeratorRecord } from '../../../shared/types';
import {
  Badge,
  EmptyState,
  Field,
  LoadingState,
  Notice,
  PageSection,
  Panel,
  revealInContent,
  StatusText,
  SwitchRow,
  type NoticeTone
} from './AdminKit';
import { groupStationsByStore, PIN_PATTERN } from './fleetFormat';
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
  const editorRef = useRef<HTMLDivElement>(null);
  const moderators = props.moderators ?? [];
  const assignable = props.stations.filter((station) => !station.removedAt);
  const assignableGroups = groupStationsByStore(assignable);
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

  const deviceOption = (station: FleetStation): JSX.Element => (
    <label key={station.id} className="fleet-device-option">
      <input
        type="checkbox"
        checked={form.stationIds.includes(station.id)}
        onChange={(event) => toggleStation(station.id, event.target.checked)}
      />
      <span className="fleet-device-option-name">{station.name || 'Unnamed device'}</span>
      {station.isCurrentDevice && <Badge>This device</Badge>}
      {station.location && <span className="fleet-device-option-place">{station.location}</span>}
    </label>
  );

  return (
    <>
      <PageSection
        title="Moderators"
        description="A moderator's PIN unlocks the Control Room on the devices you pick."
        className="fleet-moderators"
        actions={props.moderators && (
          <span className="admin-count">{moderators.length} saved</span>
        )}
      >
        {props.loadError && <Notice tone="error">{props.loadError}</Notice>}
        {listError && <Notice tone="error">{listError}</Notice>}
        {!props.moderators && props.loading && <LoadingState label="Loading moderators..." />}
        {props.moderators && moderators.length === 0 && (
          <Panel>
            <EmptyState title="No moderators yet">
              Add staff who should unlock the Control Room with their own PIN.
            </EmptyState>
          </Panel>
        )}
        {moderators.length > 0 && (
          <div className="admin-table-scroll">
            <table className="admin-table fleet-moderator-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Devices</th>
                  <th scope="col" className="fleet-moderator-status">Status</th>
                  <th scope="col" className="fleet-moderator-actions-cell"><span className="admin-visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {moderators.map((moderator) => {
                  const editing = form.id === moderator.id;
                  const confirming = confirmDeleteId === moderator.id;
                  const deleting = busyId === moderator.id;
                  const deviceNames = moderator.stationIds.map(stationName);
                  return (
                    <tr
                      key={moderator.id}
                      className={`fleet-moderator-row is-clickable${editing ? ' is-selected' : ''}${moderator.active ? '' : ' is-inactive'}`}
                      onClick={() => {
                        if (!busy && !editing) editModerator(moderator);
                      }}
                    >
                      <td className="fleet-moderator-name">{moderator.name}</td>
                      <td className="fleet-moderator-devices" title={deviceNames.join(', ')}>
                        {deviceNames.length === 0 ? <span className="fleet-cell-empty">No devices</span> : deviceNames.join(', ')}
                      </td>
                      <td>
                        <StatusText tone={moderator.active ? 'success' : 'neutral'}>{moderator.active ? 'Active' : 'Inactive'}</StatusText>
                      </td>
                      <td className="fleet-moderator-actions-cell" onClick={(event) => event.stopPropagation()}>
                        <div className="fleet-moderator-actions">
                          {confirming ? (
                            <>
                              {!deleting && (
                                <button className="admin-btn admin-btn--ghost admin-btn--sm" type="button" disabled={busy} onClick={() => setConfirmDeleteId('')}>
                                  Cancel
                                </button>
                              )}
                              <button
                                className="admin-btn admin-btn--danger admin-btn--sm confirming"
                                type="button"
                                disabled={busy}
                                onClick={() => void deleteModerator(moderator)}
                              >
                                {deleting ? 'Deleting...' : 'Delete'}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="admin-btn admin-btn--ghost admin-btn--sm"
                                type="button"
                                disabled={busy}
                                aria-current={editing ? 'true' : undefined}
                                onClick={() => editModerator(moderator)}
                              >
                                Edit
                              </button>
                              <button
                                className="admin-btn admin-btn--ghost admin-btn--danger admin-btn--sm admin-btn--icon"
                                type="button"
                                disabled={busy}
                                aria-label={`Delete ${moderator.name}`}
                                title="Delete"
                                onClick={() => void deleteModerator(moderator)}
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageSection>

      {/* Like Plans: the list, then the editor as its own section; Edit fills it, New moderator empties it. */}
      <div ref={editorRef} className="fleet-moderator-editor-anchor">
        <PageSection
          title={form.id ? 'Edit moderator' : 'Add moderator'}
          description={form.id ? 'Changes reach each device at its next sync.' : 'Give a staff member their own Control Room PIN.'}
          actions={form.id && (
            <button
              className="admin-btn admin-btn--sm"
              type="button"
              disabled={busy}
              onClick={() => {
                setForm(EMPTY_FORM);
                setNotice(null);
              }}
            >
              New moderator
            </button>
          )}
        >
          <Panel
            as="form"
            className="admin-form fleet-moderator-editor"
            aria-label={form.id ? 'Edit moderator' : 'Add moderator'}
            onSubmit={(event) => {
              event.preventDefault();
              void saveModerator();
            }}
          >
            <div className="fleet-editor-body">
              <div className="admin-form fleet-editor-fields">
                <Field label="Name" required>
                  <input
                    value={form.name}
                    maxLength={60}
                    placeholder="Staff name"
                    disabled={saving}
                    onChange={(event) => update('name', event.target.value)}
                  />
                </Field>
                <div className="form-grid">
                  <Field label="PIN" required={!form.id}>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={12}
                      value={form.pin}
                      disabled={saving}
                      onChange={(event) => update('pin', event.target.value.replace(/\D/g, ''))}
                    />
                  </Field>
                  <Field label="Confirm PIN">
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={12}
                      value={form.confirmPin}
                      disabled={saving}
                      onChange={(event) => update('confirmPin', event.target.value.replace(/\D/g, ''))}
                    />
                  </Field>
                  <small className="admin-field-help full">
                    {form.id ? 'Leave blank to keep the current PIN. ' : ''}4 to 12 digits. Use a PIN different from every device's admin PIN.
                  </small>
                </div>
                <SwitchRow
                  className="fleet-moderator-active"
                  label="Active"
                  description="Inactive moderators can't unlock any device."
                  checked={form.active}
                  disabled={saving}
                  onChange={(checked) => update('active', checked)}
                />
              </div>
              <fieldset className="fleet-device-picker" disabled={saving}>
                <legend className="admin-field-label">Devices this moderator can unlock</legend>
                <div className="fleet-device-groups">
                  {!props.stationsReady ? (
                    <p className="admin-field-help">{props.stationsError ? 'The device list did not load.' : 'Loading devices...'}</p>
                  ) : assignable.length === 0 && unknownAssigned.length === 0 ? (
                    <p className="admin-field-help">No devices yet.</p>
                  ) : (
                    assignableGroups.map((group) => (
                      <div key={group.store} className="fleet-device-group" role="group" aria-label={group.store}>
                        <p className="fleet-device-group-label" aria-hidden="true">{group.store}</p>
                        {group.stations.map(deviceOption)}
                      </div>
                    ))
                  )}
                  {unknownAssigned.length > 0 && (
                    <div className="fleet-device-group" role="group" aria-label="Unknown devices">
                      <p className="fleet-device-group-label" aria-hidden="true">Unknown devices</p>
                      {unknownAssigned.map((id) => (
                        <label key={id} className="fleet-device-option">
                          <input
                            type="checkbox"
                            checked={form.stationIds.includes(id)}
                            onChange={(event) => toggleStation(id, event.target.checked)}
                          />
                          <span className="fleet-device-option-name">Unknown device</span>
                          <span className="fleet-device-option-place admin-mono">{id}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </fieldset>
            </div>
            <footer className="admin-panel-footer">
              {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
              {!props.stationsReady && props.stationsError && (
                <Notice tone="error">Moderators can be saved once the device list loads. {props.stationsError}</Notice>
              )}
              <button className="admin-btn admin-btn--primary" type="submit" disabled={busy || !props.stationsReady}>
                {saving ? 'Saving...' : form.id ? 'Update moderator' : 'Add moderator'}
              </button>
            </footer>
          </Panel>
        </PageSection>
      </div>
    </>
  );
}
