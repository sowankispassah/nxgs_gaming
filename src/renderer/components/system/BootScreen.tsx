import { AlertTriangle } from 'lucide-react';
import { BrandLogo } from '../BrandLogo';

export function BootScreen(props: { error?: string }): JSX.Element {
  if (props.error) {
    return (
      <main className="boot-state">
        <BrandLogo className="boot-logo" />
        <AlertTriangle size={34} />
        <h1>NXGS Play failed to start</h1>
        <p>{props.error}</p>
      </main>
    );
  }

  return (
    <main className="boot-state">
      <BrandLogo className="boot-logo" />
      <h1>NXGS Play</h1>
      <p>Loading local library...</p>
    </main>
  );
}
