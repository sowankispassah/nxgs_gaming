export function isBackKeyboardEvent(event: KeyboardEvent): boolean {
  return event.key === 'Escape'
    || event.key === 'Backspace'
    || event.key === 'b'
    || event.key === 'B';
}

export function shouldKeepEditing(event: KeyboardEvent): boolean {
  if (event.key === 'Escape') return false;
  const target = event.target;
  const textInputTypes = new Set(['email', 'number', 'password', 'search', 'tel', 'text', 'url']);
  return (target instanceof HTMLInputElement && textInputTypes.has(target.type))
    || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

export function pushNavigationEntry<T>(history: T[], next: T): T[] {
  return history[history.length - 1] === next ? history : [...history, next];
}

export function popNavigationEntry<T>(history: T[], fallback: T): T[] {
  return history.length > 1 ? history.slice(0, -1) : [fallback];
}
