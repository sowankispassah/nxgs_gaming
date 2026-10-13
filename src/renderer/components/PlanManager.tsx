import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Globe,
  IndianRupee,
  LoaderCircle,
  MonitorCog,
  Pencil,
  Plus,
  ReceiptIndianRupee,
  Save,
  Trash2
} from 'lucide-react';
import type { DeviceRecord, PlanScope, PlayPlanInput, PlayPlanRecord } from '../../shared/types';
import { CardHeader, EmptyState, LoadingState, Notice, revealInContent, SwitchRow } from './admin/AdminKit';

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

export function PlanManager(props: { currentDevice: DeviceRecord }): JSX.Element {
  const [plans, setPlans] = useState<PlayPlanRecord[]>([]);
  const [form, setForm] = useState<PlanForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const editorRef = useRef<HTMLElement>(null);

  const loadPlans = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
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

  const editPlan = (plan: PlayPlanRecord): void => {
    setForm(formFromPlan(plan));
    setError('');
    setMessage('');
    revealInContent(editorRef.current);
  };

  const savePlan = async (): Promise<void> => {
    if (saving || busyAction) return;
    setSaving(true);
    setError('');
    setMessage('');
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

  const previewMinutes = Number(form.durationMinutes);
  const previewAmount = Number(form.priceRupees);
  const busy = saving || Boolean(busyAction);

  return (
    <div className="admin-columns admin-columns--plans plan-manager-grid">
      <section className="admin-card plan-list-panel">
        <CardHeader
          eyebrow="Plan library"
          title="Saved plans"
          subtitle="Enabled plans are offered to customers at checkout."
          actions={!loading && <span className="ps-chip admin-count-chip">{plans.length} saved</span>}
        />
        {loading && <LoadingState label="Loading plans..." />}
        {!loading && plans.length === 0 && (
          <EmptyState icon={<ReceiptIndianRupee size={28} />} title="No plans saved">
            Add a plan to make play-time checkout available to customers.
          </EmptyState>
        )}
        {!loading && plans.length > 0 && (
          <ol className="plan-admin-list">
            {plans.map((plan, index) => {
              const editing = form.id === plan.id;
              const confirming = confirmDeleteId === plan.id;
              const deleting = busyAction === `delete:${plan.id}`;
              return (
                <li
                  key={plan.id}
                  className={`plan-admin-row ${plan.enabled ? 'enabled' : 'disabled'}${editing ? ' selected' : ''}`}
                >
                  <div className="plan-admin-order">
                    <button
                      className="icon-button"
                      type="button"
                      title="Move plan up"
                      aria-label={`Move ${plan.name} up`}
                      disabled={index === 0 || busy}
                      onClick={() => void reorder(index, -1)}
                    >
                      {busyAction === `reorder:${plan.id}` ? <LoaderCircle className="spin" size={16} /> : <ArrowUp size={16} />}
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title="Move plan down"
                      aria-label={`Move ${plan.name} down`}
                      disabled={index === plans.length - 1 || busy}
                      onClick={() => void reorder(index, 1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                  <button className="plan-admin-summary" type="button" aria-current={editing ? 'true' : undefined} onClick={() => editPlan(plan)}>
                    <strong>{plan.name}</strong>
                    <span className="plan-admin-meta">
                      {durationLabel(plan.durationMinutes)} · Updated {new Date(plan.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                  <div className="plan-admin-tags">
                    <span className={`ps-chip ${plan.scope === 'global' ? 'ps-chip--accent' : ''}`}>
                      {plan.scope === 'global' ? <Globe size={14} /> : <MonitorCog size={14} />}
                      {plan.scope === 'global' ? 'Global' : props.currentDevice.name}
                    </span>
                    <span className={`plan-status ps-chip ${plan.enabled ? 'ps-chip--success' : ''}`}>
                      {plan.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <strong className="plan-admin-price">{priceLabel(plan)}</strong>
                  <div className="plan-admin-actions">
                    <button
                      className="secondary-action compact"
                      type="button"
                      disabled={busy}
                      onClick={() => editPlan(plan)}
                    >
                      <Pencil size={15} /> Edit
                    </button>
                    <button
                      className="secondary-action compact"
                      type="button"
                      disabled={busy}
                      onClick={() => void runAction(`toggle:${plan.id}`, async () => {
                        const result = await window.nxgs.setPlayPlanEnabled(plan.id, !plan.enabled);
                        setMessage(plan.enabled ? 'Plan disabled.' : 'Plan enabled.');
                        return result.plans;
                      })}
                    >
                      {busyAction === `toggle:${plan.id}` && <LoaderCircle className="spin" size={15} />}
                      {plan.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      className={`secondary-action compact danger${confirming ? ' confirming' : ''}`}
                      type="button"
                      disabled={busy}
                      onClick={() => {
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
                      }}
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
          </ol>
        )}
      </section>

      <section className="admin-card plan-editor-panel" ref={editorRef}>
        <CardHeader
          eyebrow="Customer pricing"
          title={form.id ? 'Edit Plan' : 'Add New Plan'}
          subtitle={form.id ? 'Changes apply the next time a customer opens checkout.' : 'Create a play-time option for checkout.'}
          actions={(
            <button
              className="secondary-action compact"
              type="button"
              title="Add new plan"
              disabled={busy}
              onClick={() => {
                setForm(EMPTY_FORM);
                setError('');
                setMessage('');
              }}
            >
              <Plus size={16} />
              New
            </button>
          )}
        />

        <form
          className="admin-form plan-form"
          onSubmit={(event) => {
            event.preventDefault();
            void savePlan();
          }}
        >
          <label className="admin-field">
            <span className="admin-field-label">
              Plan name <em className="required-badge">Required</em>
            </span>
            <input
              value={form.name}
              maxLength={80}
              placeholder="30 Minutes"
              onChange={(event) => update('name', event.target.value)}
              disabled={saving}
            />
          </label>
          <div className="form-grid plan-number-fields">
            <label className="admin-field">
              <span className="admin-field-label">Duration</span>
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
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Price amount</span>
              <span className="admin-affix-input plan-price-input">
                <IndianRupee size={17} aria-hidden="true" />
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
            </label>
          </div>
          <label className="admin-field">
            <span className="admin-field-label">Currency</span>
            <select value={form.currency} onChange={(event) => update('currency', event.target.value)} disabled={saving}>
              <option value="INR">₹ / INR</option>
            </select>
          </label>
          <label className="admin-field">
            <span className="admin-field-label">Availability</span>
            <select
              value={form.scope}
              onChange={(event) => update('scope', event.target.value as PlanScope)}
              disabled={saving}
            >
              <option value="device">This device ({props.currentDevice.name})</option>
              <option value="global">Global plan</option>
            </select>
            <small className="field-note">
              Device plans apply only here. Global plans can be shared by future synced devices.
            </small>
          </label>
          <SwitchRow
            label="Enabled on customer payment screen"
            checked={form.enabled}
            disabled={saving}
            onChange={(checked) => update('enabled', checked)}
          />

          <div className="plan-preview" aria-label="Customer preview">
            <span className="admin-section-title">Customer preview</span>
            <div className="plan-preview-row">
              <span className="plan-preview-copy">
                <strong>{form.name.trim() || 'Plan name'}</strong>
                <small>{Number.isFinite(previewMinutes) && previewMinutes > 0 ? durationLabel(previewMinutes) : 'Set a duration'}</small>
              </span>
              <strong className="plan-preview-price">
                {Number.isFinite(previewAmount) && previewAmount > 0 ? formatAmount(previewAmount, form.currency) : '—'}
              </strong>
            </div>
          </div>

          <footer className="admin-card-footer admin-card-footer--stacked">
            {message && <Notice tone="success">{message}</Notice>}
            {error && <Notice tone="error">{error}</Notice>}
            <button className="primary-action wide" type="submit" disabled={busy}>
              {saving ? <LoaderCircle className="spin" size={19} /> : <Save size={19} />}
              {saving ? 'Saving...' : form.id ? 'Update Plan' : 'Add Plan'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
