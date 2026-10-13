import { useEffect, useState } from 'react';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function formatConsoleTime(date: Date): string {
  return timeFormat.format(date);
}

/** Current time, refreshed on the next minute boundary (or `intervalMs`). */
export function useNow(intervalMs?: number): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: number | undefined;
    const schedule = (): void => {
      const current = new Date();
      const delay = intervalMs ?? 60_000 - (current.getSeconds() * 1000 + current.getMilliseconds()) + 20;
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, delay);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [intervalMs]);

  return now;
}

export function ConsoleClock(props: { className?: string }): JSX.Element {
  const now = useNow();
  return (
    <time className={props.className ? `console-clock ${props.className}` : 'console-clock'} dateTime={now.toISOString()}>
      {formatConsoleTime(now)}
    </time>
  );
}
