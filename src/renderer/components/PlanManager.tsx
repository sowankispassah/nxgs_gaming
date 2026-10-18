import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, LoaderCircle, Trash2 } from 'lucide-react';
import type { DeviceRecord, PlanScope, PlayPlanInput, PlayPlanRecord } from '../../shared/types';
import { EmptyState, Field, InlineSwitch, LoadingState, Notice, PageActions, PageSection, Panel, revealInContent, SwitchRow } from './admin/AdminKit';
import { dateLabel } from './admin/fleetFormat';

type PlanForm = {
  id?: string;
  name: string;
  durationMinutes: string;
  priceRupees: string;
  currency: string;
  scope: PlanScope;
  enabled: boolean;
};

const EMPTY_FORM: PlanForm = {
  name: '',
  durationMinutes: '30',
  priceRupees: '50',
  currency: 'INR',
  scope: 'device',
  enabled: true
};

function formFromPlan(plan: PlayPlanRecord): PlanForm {
  return {
    id: plan.id,
    name: plan.name,
    durationMinutes: String(plan.durationMinutes),
    priceRupees: String(plan.amountPaise / 100),
    currency: plan.currency,
    scope: plan.scope,
    enabled: plan.enabled
  };
}

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2
  }).format(amount);
}

function priceLabel(plan: PlayPlanRecord): string {
  return formatAmount(plan.amountPaise / 100, plan.currency);
}

/** Which part of the page the last message belongs to: the plans table or the editor. */
type FeedbackArea = 'list' | 'editor';

export function PlanManager(props: { currentDevice: DeviceRecord }): JSX.Element {
  const [plans, setPlans] = useState<PlayPlanRecord[]>([]);
  const [form, setForm] = useState<PlanForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [feedbackArea, setFeedbackArea] = useState<FeedbackArea>('list');
  const editorRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const loadPlans = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    setFeedbackArea('list');
    try {
      setPlans(await window.nxgs.listPlayPlans());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const update = <K extends keyof PlanForm>(key: K, value: PlanForm[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const openEditor = (next: PlanForm): void => {
    setForm(next);
    setError('');
    setMessage('');
    setConfirmDeleteId('');
    revealInContent(editorRef.current);
    nameRef.current?.focus({ preventScroll: true });
  };

  const editPlan = (plan: PlayPlanRecord): void => openEditor(formFromPlan(plan));
  const newPlan = (): void => openEditor(EMPTY_FORM);

  const savePlan = async (): Promise<void> => {
    if (saving || busyAction) return;
    setSaving(true);
    setError('');
    setMessage('');
    setFeedbackArea('editor');
    try {
      const input: PlayPlanInput = {
        id: form.id,
        name: form.name,
        durationMinutes: Number(form.durationMinutes),
        amountPaise: Math.round(Number(form.priceRupees) * 100),
        currency: form.currency,
        scope: form.scope,
        enabled: form.enabled
      };
      const result = await window.nxgs.savePlayPlan(input);
      setPlans(result.plans);
      if (result.plan) setForm(formFromPlan(result.plan));
      setMessage(form.id ? 'Plan updated.' : 'Plan added.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (key: string, action: () => Promise<PlayPlanRecord[]>): Promise<void> => {
    if (busyAction || saving) return;
    setBusyAction(key);
    setError('');
    setMessage('');
    setFeedbackArea('list');
    try {
      setPlans(await action());
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusyAction('');
    }
  };

  const reorder = (index: number, delta: number): Promise<void> => {
    const destination = index + delta;
    if (destination < 0 || destination >= plans.length) return Promise.resolve();
    const reordered = [...plans];
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    return runAction(`reorder:${plans[index].id}`, async () => {
      const result = await window.nxgs.reorderPlayPlans(reordered.map((plan) => plan.id));
      setMessage('Display order updated.');
      return result.plans;
    });
  };

  const toggleEnabled = (plan: PlayPlanRecord): Promise<void> =>
    runAction(`toggle:${plan.id}`, async () => {
      const result = await window.nxgs.setPlayPlanEnabled(plan.id, !plan.enabled);
      setMessage(plan.enabled ? 'Plan disabled.' : 'Plan enabled.');
      return result.plans;
    });

  const deletePlan = (plan: PlayPlanRecord): void => {
    if (confirmDeleteId !== plan.id) {
      setConfirmDeleteId(plan.id);
      return;
    }
    void runAction(`delete:${plan.id}`, async () => {
      const result = await window.nxgs.deletePlayPlan(plan.id);
      if (form.id === plan.id) setForm(EMPTY_FORM);
      setConfirmDeleteId('');
      setMessage('Plan deleted.');
      return result.plans;
    });
  };

  const previewMinutes = Number(form.durationMinutes);
  const previewAmount = Number(form.priceRupees);
  const busy = saving || Boolean(busyAction);
  const enabledCount = plans.filter((plan) => plan.enabled).length;
  const feedback = (area: FeedbackArea): JSX.Element | null =>
    feedbackArea !== area ? null : error ? <Notice tone="error">{error}</Notice> : message ? <Notice tone="success">{message}</Notice> : null;

  return (
    <div className="admin-stack plan-manager">
      <PageActions>
        <button className="admin-btn" type="button" disabled={busy} onClick={newPlan}>
          New plan
        </button>
      </PageActions>

      <PageSection
        title="Saved plans"
        description="Enabled plans are offered to customers at checkout."
        actions={!loading && plans.length > 0 && (
          <span className="admin-count">{plans.length} saved · {enabledCount} enabled</span>
        )}
      >
        {loading && <LoadingState label="Loading plans..." />}
        {!loading && plans.length === 0 && (
          <Panel>
            <EmptyState title="No plans saved">
              Add a plan to make play-time checkout available to customers.
            </EmptyState>
          </Panel>
        )}
        {!loading && plans.length > 0 && (
          <div className="admin-table-scroll">
            <table className="admin-table plan-table">
              <thead>
                <tr>
                  <th scope="col" className="plan-col-order"><span className="admin-visually-hidden">Order</span></th>
                  <th scope="col">Plan</th>
                  <th scope="col">Availability</th>
                  <th scope="col" className="admin-num">Duration</th>
                  <th scope="col" className="admin-num">Price</th>
                  <th scope="col" className="plan-col-updated">Updated</th>
                  <th scope="col" className="plan-col-enabled">Enabled</th>
                  <th scope="col" className="plan-col-actions"><span className="admin-visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan, index) => {
                  const editing = form.id === plan.id;
                  const confirming = confirmDeleteId === plan.id;
                  const deleting = busyAction === `delete:${plan.id}`;
                  const toggling = busyAction === `toggle:${plan.id}`;
                  return (
                    <tr
                      key={plan.id}
                      className={`plan-admin-row${plan.enabled ? '' : ' is-disabled'}${editing ? ' is-selected' : ''}`}
                      aria-current={editing ? 'true' : undefined}
                    >
                      <td className="plan-col-order">
                        <span className="plan-order">
                          <button
                            className="admin-btn admin-btn--icon admin-btn--sm admin-btn--ghost"
                            type="button"
                            title="Move plan up"
                            aria-label={`Move ${plan.name} up`}
                            disabled={index === 0 || busy}
                            onClick={() => void reorder(index, -1)}
                          >
                            {busyAction === `reorder:${plan.id}` ? <LoaderCircle className="spin" size={14} /> : <ArrowUp size={14} />}
                          </button>
                          <button
                            className="admin-btn admin-btn--icon admin-btn--sm admin-btn--ghost"
                            type="button"
                            title="Move plan down"
                            aria-label={`Move ${plan.name} down`}
                            disabled={index === plans.length - 1 || busy}
                            onClick={() => void reorder(index, 1)}
                          >
                            <ArrowDown size={14} />
                          </button>
                        </span>
                      </td>
                      <td className="plan-col-name">
                        <span className="plan-name" title={plan.name}>{plan.name}</span>
                      </td>
                      <td className="plan-col-scope">
                        <span className="admin-text-2" title={plan.scope === 'global' ? 'Global plan' : `This device (${props.currentDevice.name})`}>
                          {plan.scope === 'global' ? 'Global' : props.currentDevice.name}
                        </span>
                      </td>
                      <td className="admin-num">{durationLabel(plan.durationMinutes)}</td>
                      <td className="admin-num plan-price">{priceLabel(plan)}</td>
                      <td className="plan-col-updated admin-text-2">{dateLabel(plan.updatedAt)}</td>
                      <td className="plan-col-enabled">
                        <InlineSwitch
                          checked={plan.enabled}
                          disabled={busy}
                          busy={toggling}
                          title={plan.enabled ? 'Enabled' : 'Disabled'}
                          aria-label={`${plan.name} on customer payment screen`}
                          onChange={() => void toggleEnabled(plan)}
                        />
                      </td>
                      <td className="plan-col-actions">
                        <span className="plan-actions">
                          {deleting ? null : confirming ? (
                            <button className="admin-btn admin-btn--sm admin-btn--ghost" type="button" disabled={busy} onClick={() => setConfirmDeleteId('')}>
                              Cancel
                            </button>
                          ) : (
                            <button
                              className="admin-btn admin-btn--sm admin-btn--ghost"
                              type="button"
                              disabled={busy}
                              aria-label={`Edit ${plan.name}`}
                              onClick={() => editPlan(plan)}
                            >
                              Edit
                            </button>
                          )}
                          {confirming || deleting ? (
                            <button
                              className="admin-btn admin-btn--sm admin-btn--danger confirming"
                              type="button"
                              disabled={busy}
                              onClick={() => deletePlan(plan)}
                            >
                              {deleting ? 'Deleting...' : 'Delete'}
                            </button>
                          ) : (
                            <button
                              className="admin-btn admin-btn--icon admin-btn--sm admin-btn--ghost admin-btn--danger"
                              type="button"
                              title="Delete plan"
                              aria-label={`Delete ${plan.name}`}
                              disabled={busy}
                              onClick={() => deletePlan(plan)}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {feedback('list')}
      </PageSection>

      <div className="plan-editor-panel" ref={editorRef}>
        <PageSection
          title={form.id ? 'Edit plan' : 'New plan'}
          description={form.id ? 'Changes apply the next time a customer opens checkout.' : 'Create a play-time option for checkout.'}
          actions={form.id && (
            <button className="admin-btn admin-btn--sm admin-btn--ghost" type="button" disabled={busy} onClick={newPlan}>
              Cancel
            </button>
          )}
        >
          <Panel
            as="form"
            className="plan-editor"
            onSubmit={(event) => {
              event.preventDefault();
              void savePlan();
            }}
          >
            <div className="plan-editor-body">
              <div className="form-grid plan-editor-fields">
                <Field label="Plan name" required className="full">
                  <input
                    ref={nameRef}
                    value={form.name}
                    maxLength={80}
                    placeholder="30 Minutes"
                    onChange={(event) => update('name', event.target.value)}
                    disabled={saving}
                  />
                </Field>
                <Field label="Duration">
                  <span className="admin-affix-input">
                    <input
                      type="number"
                      min="1"
                      max="1440"
                      step="1"
                      value={form.durationMinutes}
                      onChange={(event) => update('durationMinutes', event.target.value)}
                      disabled={saving}
                    />
                    <em>min</em>
                  </span>
                </Field>
                <Field label="Price">
                  <span className="admin-affix-input">
                    <em aria-hidden="true">₹</em>
                    <input
                      type="number"
                      min="1"
                      max="100000"
                      step="0.01"
                      value={form.priceRupees}
                      onChange={(event) => update('priceRupees', event.target.value)}
                      disabled={saving}
                    />
                  </span>
                </Field>
                <Field label="Currency">
                  <select value={form.currency} onChange={(event) => update('currency', event.target.value)} disabled={saving}>
                    <option value="INR">₹ / INR</option>
                  </select>
                </Field>
                <Field label="Availability" help="Device plans apply only here. Global plans can be shared by future synced devices.">
                  <select
                    value={form.scope}
                    onChange={(event) => update('scope', event.target.value as PlanScope)}
                    disabled={saving}
                  >
                    <option value="device">This device ({props.currentDevice.name})</option>
                    <option value="global">Global plan</option>
                  </select>
                </Field>
                <div className="full plan-editor-switch">
                  <SwitchRow
                    label="Enabled on customer payment screen"
                    description="Disabled plans stay saved but are not offered at checkout."
                    checked={form.enabled}
                    disabled={saving}
                    onChange={(checked) => update('enabled', checked)}
                  />
                </div>
              </div>

              <aside className="plan-preview" aria-label="Customer preview">
                <span className="admin-subheading">Customer preview</span>
                <div className="plan-preview-row">
                  <span className="plan-preview-copy">
                    <strong>{form.name.trim() || 'Plan name'}</strong>
                    <small>{Number.isFinite(previewMinutes) && previewMinutes > 0 ? durationLabel(previewMinutes) : 'Set a duration'}</small>
                  </span>
                  <strong className="plan-preview-price">
                    {Number.isFinite(previewAmount) && previewAmount > 0 ? formatAmount(previewAmount, form.currency) : '—'}
                  </strong>
                </div>
                <p className="admin-caption">
                  {form.enabled ? 'Shown at checkout once saved.' : 'Hidden at checkout while disabled.'}
                </p>
              </aside>
            </div>

            <footer className="admin-panel-footer">
              {feedback('editor') ?? <span aria-hidden="true" />}
              <button className="admin-btn admin-btn--primary" type="submit" disabled={busy}>
                {saving ? 'Saving...' : form.id ? 'Save plan' : 'Add plan'}
              </button>
            </footer>
          </Panel>
        </PageSection>
      </div>
    </div>
  );
}
