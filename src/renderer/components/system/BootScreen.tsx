import { AlertTriangle } from 'lucide-react';
import { BrandLogo } from '../BrandLogo';

export function BootScreen(props: { error?: string }): JSX.Element {
  if (props.error) {
    return (
      <main className="boot-state boot-state--error">
        <div className="boot-brand">
          <BrandLogo className="boot-logo" />
        </div>
        <section className="boot-error" role="alert">
          <span className="boot-error-icon" aria-hidden="true"><AlertTriangle size={30} /></span>
          <h1>NXGS Play failed to start</h1>
          <p>{props.error}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="boot-state" aria-busy="true">
      <div className="boot-brand">
        <BrandLogo className="boot-logo" />
        <span className="boot-sweep" aria-hidden="true">
          <BrandLogo className="boot-sweep-logo" alt="" />
        </span>
      </div>
      <h1 className="dialog-sr-only">NXGS Play</h1>
      <p className="boot-status" role="status">
        <span className="boot-spinner spin" aria-hidden="true" />
        Loading local library...
      </p>
    </main>
  );
}
