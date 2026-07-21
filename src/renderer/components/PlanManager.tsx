import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  IndianRupee,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  Trash2
} from 'lucide-react';
import type { PlayPlanInput, PlayPlanRecord } from '../../shared/types';

type PlanForm = {
  id?: string;
  name: string;
  durationMinutes: string;
  priceRupees: string;
  currency: string;
  enabled: boolean;
};

const EMPTY_FORM: PlanForm = {
  name: '',
  durationMinutes: '30',
  priceRupees: '50',
  currency: 'INR',
  enabled: true
};

function formFromPlan(plan: PlayPlanRecord): PlanForm {
  return {
    id: plan.id,
    name: plan.name,
    durationMinutes: String(plan.durationMinutes),
    priceRupees: String(plan.amountPaise / 100),
    currency: plan.currency,
    enabled: plan.enabled
  };
}

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function priceLabel(plan: PlayPlanRecord): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: plan.currency,
    minimumFractionDigits: 2
  }).format(plan.amountPaise / 100);
}

export function PlanManager(): JSX.Element {
  const [plans, setPlans] = useState<PlayPlanRecord[]>([]);
  const [form, setForm] = useState<PlanForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

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

  return (
    <div className="plan-manager-grid">
      <section className="panel plan-editor-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Customer pricing</p>
            <h2>{form.id ? 'Edit Plan' : 'Add New Plan'}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            title="Add new plan"
            disabled={saving || Boolean(busyAction)}
            onClick={() => {
              setForm(EMPTY_FORM);
              setError('');
              setMessage('');
            }}
          >
            <Plus size={20} />
          </button>
        </div>

        <form
          className="form-grid single"
          onSubmit={(event) => {
            event.preventDefault();
            void savePlan();
          }}
        >
          <label>
            Plan name <em className="required-badge">Required</em>
            <input
              value={form.name}
              maxLength={80}
              placeholder="30 Minutes"
              onChange={(event) => update('name', event.target.value)}
              disabled={saving}
            />
          </label>
          <div className="form-grid plan-number-fields">
            <label>
              Duration (minutes)
              <input
                type="number"
                min="1"
                max="1440"
                step="1"
                value={form.durationMinutes}
                onChange={(event) => update('durationMinutes', event.target.value)}
                disabled={saving}
              />
            </label>
            <label>
              Price amount
              <span className="plan-price-input">
                <IndianRupee size={17} />
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
          <label>
            Currency
            <select value={form.currency} onChange={(event) => update('currency', event.target.value)} disabled={saving}>
              <option value="INR">₹ / INR</option>
            </select>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => update('enabled', event.target.checked)}
              disabled={saving}
            />
            Enabled on customer payment screen
          </label>
          <button className="primary-action wide" type="submit" disabled={saving || Boolean(busyAction)}>
            {saving ? <LoaderCircle className="spin" size={19} /> : <Save size={19} />}
            {saving ? 'Saving...' : form.id ? 'Update Plan' : 'Add Plan'}
          </button>
        </form>
        {message && <p className="success-text" role="status">{message}</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
      </section>

      <section className="panel plan-list-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Plan library</p>
            <h2>{plans.length} saved</h2>
          </div>
        </div>
        {loading && <div className="admin-loading"><LoaderCircle className="spin" /> Loading plans...</div>}
        {!loading && plans.length === 0 && (
          <div className="plan-empty-state">
            <h3>No plans saved</h3>
            <p>Add a plan to make play-time checkout available to customers.</p>
          </div>
        )}
        {!loading && plans.length > 0 && (
          <div className="plan-admin-list">
            {plans.map((plan, index) => {
              return (
                <article key={plan.id} className={`plan-admin-row ${plan.enabled ? 'enabled' : 'disabled'}`}>
                  <div className="plan-admin-order">
                    <button
                      className="icon-button"
                      type="button"
                      title="Move plan up"
                      disabled={index === 0 || Boolean(busyAction) || saving}
                      onClick={() => void reorder(index, -1)}
                    >
                      {busyAction === `reorder:${plan.id}` ? <LoaderCircle className="spin" size={17} /> : <ArrowUp size={17} />}
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title="Move plan down"
                      disabled={index === plans.length - 1 || Boolean(busyAction) || saving}
                      onClick={() => void reorder(index, 1)}
                    >
                      <ArrowDown size={17} />
                    </button>
                  </div>
                  <button className="plan-admin-summary" type="button" onClick={() => setForm(formFromPlan(plan))}>
                    <strong>{plan.name}</strong>
                    <span>{durationLabel(plan.durationMinutes)} · {priceLabel(plan)}</span>
                    <small>Updated {new Date(plan.updatedAt).toLocaleDateString()}</small>
                  </button>
                  <span className={`plan-status ${plan.enabled ? 'enabled' : 'disabled'}`}>
                    {plan.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <div className="plan-admin-actions">
                    <button
                      className="secondary-action compact"
                      type="button"
                      disabled={Boolean(busyAction) || saving}
                      onClick={() => setForm(formFromPlan(plan))}
                    >
                      <Pencil size={16} /> Edit
                    </button>
                    <button
                      className="secondary-action compact"
                      type="button"
                      disabled={Boolean(busyAction) || saving}
                      onClick={() => void runAction(`toggle:${plan.id}`, async () => {
                        const result = await window.nxgs.setPlayPlanEnabled(plan.id, !plan.enabled);
                        setMessage(plan.enabled ? 'Plan disabled.' : 'Plan enabled.');
                        return result.plans;
                      })}
                    >
                      {busyAction === `toggle:${plan.id}` && <LoaderCircle className="spin" size={16} />}
                      {plan.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      className="secondary-action compact danger"
                      type="button"
                      disabled={Boolean(busyAction) || saving}
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
                      {busyAction === `delete:${plan.id}` ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
                      {busyAction === `delete:${plan.id}` ? 'Deleting...' : confirmDeleteId === plan.id ? 'Confirm' : 'Delete'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
