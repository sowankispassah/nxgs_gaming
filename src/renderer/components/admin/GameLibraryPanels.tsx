import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import {
  FileUp,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  Plus,
  Save,
  ScanSearch,
  Search,
  Trash2,
  X
} from 'lucide-react';
import type {
  DeviceRecord,
  GameInput,
  GameRecord,
  GameSuggestion,
  LaunchType
} from '../../../shared/types';
import { useControllerNavigation, type ControllerNavigationEvent } from '../../controllerNavigation';
import { ControllerHints } from '../../ui/ControllerHints';
import { playUiSound } from '../../ui/uiSound';
import {
  ArtImage,
  Badge,
  EmptyState,
  Field,
  LoadingState,
  Notice,
  PageActions,
  PageSection,
  Panel,
  revealInContent,
  Segmented,
  StatusText,
  SwitchRow,
  Toolbar,
  ToolbarSpacer,
  type NoticeTone,
  type Tone
} from './AdminKit';
import { timeLabel } from './fleetFormat';

const EMPTY_GAME: GameInput = {
  title: '',
  avatarImagePath: '',
  coverImagePath: '',
  source: 'Manual',
  availabilityStatus: 'unknown',
  launchType: 'localExe',
  launchCommand: '',
  workingDirectory: '',
  processName: '',
  launchArguments: '',
  launchMode: 'borderlessPreferred',
  enabled: true
};

const SOURCE_OPTIONS = ['Manual', 'Steam', 'Epic Games', 'Microsoft Store', 'Start Menu', 'Local', 'Local Folder', 'Custom'] as const;

type FormMessage = { tone: NoticeTone; text: string } | null;

type ScanFilter = 'all' | GameSuggestion['status'];

const CONFIDENCE: Record<GameSuggestion['confidence'], { label: string; level: number }> = {
  high: { label: 'High', level: 3 },
  medium: { label: 'Medium', level: 2 },
  low: { label: 'Low', level: 1 }
};

function launchTypeLabel(launchType: LaunchType): string {
  if (launchType === 'steam') {
    return 'Steam game';
  }
  if (launchType === 'epic') {
    return 'Epic game';
  }
  if (launchType === 'microsoftStore') {
    return 'Microsoft Store app';
  }
  if (launchType === 'localExe') {
    return 'Local executable';
  }
  return 'Custom command';
}

function suggestionStatus(status: GameSuggestion['status']): { label: string; tone: Tone } {
  if (status === 'ready') return { label: 'Ready', tone: 'success' };
  if (status === 'needs-confirmation') return { label: 'Needs confirmation', tone: 'warning' };
  return { label: 'Unsupported', tone: 'neutral' };
}

function gameStatus(game: GameRecord): { label: string; tone: Tone } {
  if (!game.enabled || game.availabilityStatus === 'disabled') return { label: 'Disabled', tone: 'neutral' };
  if (game.availabilityStatus === 'available') return { label: 'Available', tone: 'success' };
  if (game.availabilityStatus === 'missing') return { label: 'Missing', tone: 'danger' };
  // Same words and colour as the main admin sees on All devices.
  return { label: 'Not checked', tone: 'neutral' };
}

function normalizeForm(game?: GameRecord | GameInput): GameInput {
  return {
    ...EMPTY_GAME,
    ...(game ?? {})
  };
}

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter((word) => /^[A-Za-z0-9]/.test(word))
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

/** 32px artwork square; muted initials when the game has no artwork yet. */
function GameThumb(props: { path?: string; title: string }): JSX.Element {
  return (
    <ArtImage
      className="game-thumb"
      path={props.path}
      fallback={<span className="game-thumb-initials" aria-hidden="true">{initials(props.title) || '?'}</span>}
    />
  );
}

/** Three short bars and a word: how sure the scanner is that this is a playable game. */
function Confidence(props: { value: GameSuggestion['confidence'] }): JSX.Element {
  const confidence = CONFIDENCE[props.value] ?? CONFIDENCE.low;
  return (
    <span className="scan-confidence" data-level={confidence.level} title={`${confidence.label} confidence`}>
      <span className="scan-confidence-bars" aria-hidden="true"><i /><i /><i /></span>
      {confidence.label}
    </span>
  );
}

export function GameManager(props: { currentDevice: DeviceRecord; games: GameRecord[]; onGamesChanged: (games: GameRecord[]) => void }): JSX.Element {
  const [form, setForm] = useState<GameInput>(EMPTY_GAME);
  const [pending, setPending] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [message, setMessage] = useState<FormMessage>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const chooseButtonRef = useRef<HTMLButtonElement>(null);

  const closePicker = (): void => {
    setPickerOpen(false);
    chooseButtonRef.current?.focus({ preventScroll: true });
  };

  const update = <K extends keyof GameInput>(key: K, value: GameInput[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const startNewGame = (): void => {
    setForm(EMPTY_GAME);
    setMessage(null);
  };

  const applySuggestion = (suggestion: GameSuggestion): void => {
    setForm({
      title: suggestion.title,
      avatarImagePath: suggestion.avatarImagePath ?? suggestion.iconPath ?? suggestion.coverImagePath ?? '',
      coverImagePath: suggestion.coverImagePath ?? '',
      source: suggestion.source,
      availabilityStatus: suggestion.availabilityStatus,
      launchType: suggestion.launchType,
      launchCommand: suggestion.launchCommand,
      workingDirectory: suggestion.workingDirectory ?? '',
      processName: suggestion.processName ?? '',
      launchArguments: '',
      enabled: suggestion.enabled ?? true
    });
    setMessage({ tone: 'info', text: `${suggestion.title} selected. Review and save it to add it to the customer library.` });
  };

  const saveGame = async (): Promise<void> => {
    setPending(true);
    setMessage(null);
    try {
      const result = await window.nxgs.saveGame(form);
      props.onGamesChanged(result.games);
      setForm(normalizeForm(result.game));
      setMessage({ tone: 'success', text: 'Saved game.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setPending(false);
    }
  };

  const deleteGame = async (game: GameRecord): Promise<void> => {
    setDeletingId(game.id);
    try {
      const result = await window.nxgs.deleteGame(game.id);
      props.onGamesChanged(result.games);
      if (form.id === game.id) {
        setForm(EMPTY_GAME);
      }
    } finally {
      setDeletingId('');
    }
  };

  // Up and Down move between games while focus is in the list (the list keeps arrows local).
  const moveListFocus = (event: ReactKeyboardEvent<HTMLUListElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('.admin-list-row') ?? [])];
    const current = event.target instanceof Element ? event.target.closest<HTMLElement>('.admin-list-row') : null;
    const index = current ? rows.indexOf(current) : -1;
    if (index === -1) return;
    event.preventDefault();
    const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
    next?.querySelector<HTMLButtonElement>('.row-main')?.focus();
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visibleGames = normalizedQuery
    ? props.games.filter((game) =>
      [game.title, game.source, launchTypeLabel(game.launchType)].join(' ').toLowerCase().includes(normalizedQuery))
    : props.games;
  const countLabel = normalizedQuery ? `${visibleGames.length} of ${props.games.length}` : `${props.games.length} saved`;

  return (
    <div className="games-layout">
      <PageActions>
        <button className="admin-btn" type="button" title="New game" onClick={startNewGame}>
          <Plus size={15} />
          New game
        </button>
        <button ref={chooseButtonRef} className="admin-btn admin-btn--primary" type="button" onClick={() => setPickerOpen(true)}>
          <Search size={15} />
          Choose installed game
        </button>
      </PageActions>

      <PageSection
        className="games-library"
        title="Customer games"
        description={`Only games linked to ${props.currentDevice.name}`}
        actions={props.games.length > 0 ? <span className="admin-count">{countLabel}</span> : undefined}
      >
        <Panel padding="none" className="games-library-panel">
          {props.games.length === 0 ? (
            <EmptyState
              title="No games linked yet"
              action={(
                <button className="admin-btn" type="button" onClick={() => setPickerOpen(true)}>
                  <Search size={15} />
                  Choose installed game
                </button>
              )}
            >
              Pick one of the games detected on this device, or add one by hand with New game.
            </EmptyState>
          ) : (
            <>
              <div className="games-search">
                <label className="admin-affix-input">
                  <Search size={15} aria-hidden="true" />
                  <input
                    value={query}
                    placeholder="Search games"
                    aria-label="Search games"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query && (
                    <button className="games-search-clear" type="button" aria-label="Clear search" onClick={() => setQuery('')}>
                      <X size={14} />
                    </button>
                  )}
                </label>
              </div>
              {visibleGames.length === 0 ? (
                <EmptyState title="No games match your search">
                  Try a shorter name, or clear the search to see all {props.games.length} games.
                </EmptyState>
              ) : (
                <ul
                  className="admin-list games-list"
                  ref={listRef}
                  aria-label="Customer games"
                  data-admin-local-keys="true"
                  onKeyDown={moveListFocus}
                >
                  {visibleGames.map((game) => {
                    const status = gameStatus(game);
                    const selected = form.id === game.id;
                    return (
                      <li key={game.id} className={`admin-list-row game-row${selected ? ' selected' : ''}`}>
                        <button
                          type="button"
                          className="row-main"
                          aria-current={selected ? 'true' : undefined}
                          onClick={() => {
                            setForm(normalizeForm(game));
                            setMessage(null);
                            revealInContent(editorRef.current);
                          }}
                        >
                          <GameThumb path={game.avatarImagePath || game.coverImagePath} title={game.title} />
                          <span className="game-row-copy">
                            <strong title={game.title}>{game.title}</strong>
                            <span>{launchTypeLabel(game.launchType)}</span>
                          </span>
                          <StatusText tone={status.tone} className="game-row-status">{status.label}</StatusText>
                        </button>
                        <button
                          className="admin-btn admin-btn--icon admin-btn--sm admin-btn--ghost admin-btn--danger"
                          type="button"
                          title="Delete game"
                          aria-label={`Delete ${game.title}`}
                          disabled={deletingId === game.id}
                          onClick={() => void deleteGame(game)}
                        >
                          {deletingId === game.id ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </Panel>
      </PageSection>

      <div className="games-editor" ref={editorRef}>
        <PageSection
          title={form.id ? 'Edit game' : 'Add game'}
          description={form.id ? `Editing ${form.title || 'an untitled game'} on ${props.currentDevice.name}` : `New games are linked to ${props.currentDevice.name}`}
        >
          <Panel padding="none" className="game-editor-panel">
            <GameForm form={form} onChange={update} />
            <footer className="admin-panel-footer game-editor-footer">
              {message ? <Notice tone={message.tone}>{message.text}</Notice> : <span aria-hidden="true" />}
              <button className="admin-btn admin-btn--primary" type="button" disabled={pending} onClick={() => void saveGame()}>
                {pending ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
                {pending ? 'Saving...' : 'Save game'}
              </button>
            </footer>
          </Panel>
        </PageSection>
      </div>

      {pickerOpen && (
        <InstalledGamePicker
          onClose={closePicker}
          onSelect={(suggestion) => {
            applySuggestion(suggestion);
            closePicker();
          }}
        />
      )}
    </div>
  );
}

function InstalledGamePicker(props: { onClose: () => void; onSelect: (suggestion: GameSuggestion) => void }): JSX.Element {
  const [suggestions, setSuggestions] = useState<GameSuggestion[]>([]);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [focusId, setFocusId] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    setPending(true);
    setError('');
    window.nxgs
      .scanInstalledGames()
      .then((found) => {
        if (mounted) {
          setSuggestions(found);
        }
      })
      .catch((scanError) => {
        if (mounted) {
          setError(scanError instanceof Error ? scanError.message : String(scanError));
        }
      })
      .finally(() => {
        if (mounted) {
          setPending(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredSuggestions = suggestions.filter((suggestion) => {
    if (!normalizedQuery) {
      return true;
    }
    return [suggestion.title, suggestion.source, suggestion.launchMethod, suggestion.launchCommand]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery);
  });
  const selectableIds = filteredSuggestions
    .filter((suggestion) => suggestion.status !== 'unsupported')
    .map((suggestion) => suggestion.suggestionId);

  const rowElement = (id: string): HTMLButtonElement | null =>
    listRef.current?.querySelector<HTMLButtonElement>(`[data-suggestion-id="${CSS.escape(id)}"]`) ?? null;

  const close = (): void => {
    if (pending) return;
    playUiSound('back');
    props.onClose();
  };

  const moveFocus = (delta: number): void => {
    const next = selectableIds.indexOf(focusId) + delta;
    if (next < -1 || next >= selectableIds.length) return;
    const nextId = next === -1 ? '' : selectableIds[next];
    if (nextId) rowElement(nextId)?.focus();
    else searchRef.current?.focus();
    setFocusId(nextId);
    playUiSound('move');
  };

  const acceptFocused = (): void => {
    const row = focusId ? rowElement(focusId) : null;
    if (!row) {
      moveFocus(1);
      return;
    }
    playUiSound('select');
    row.click();
  };

  const latest = useRef({ close, moveFocus });
  latest.current = { close, moveFocus };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const typing = event.target instanceof HTMLInputElement;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        latest.current.close();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        latest.current.moveFocus(event.key === 'ArrowDown' ? 1 : -1);
      } else if (!typing && ['ArrowLeft', 'ArrowRight', 'b', 'B', 'Backspace'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') latest.current.close();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const handlePickerControllerEvent = (event: ControllerNavigationEvent): void => {
    if (event.type === 'back') close();
    else if (event.type === 'accept') acceptFocused();
    else if (event.direction === 'up' || event.direction === 'down') moveFocus(event.direction === 'down' ? 1 : -1);
  };

  useControllerNavigation(true, handlePickerControllerEvent);

  return (
    <div className="modal-backdrop">
      <section
        className="modal installed-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="installed-picker-title"
        aria-describedby="installed-picker-description"
      >
        <button className="admin-btn admin-btn--icon admin-btn--ghost close-button" type="button" title="Close" aria-label="Close" onClick={props.onClose} disabled={pending}>
          <X size={16} />
        </button>
        <header className="installed-picker-header">
          <h2 id="installed-picker-title">Choose installed game</h2>
          <p id="installed-picker-description">Apps and games detected on this device. Pick one to fill in its details, then save it.</p>
        </header>
        <div className="installed-picker-toolbar">
          <label className="admin-affix-input installed-picker-search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={searchRef}
              autoFocus
              aria-label="Search installed games"
              placeholder="Search installed games, for example Chicken Invaders"
              value={query}
              onFocus={() => setFocusId('')}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {!pending && <span className="installed-picker-count">{filteredSuggestions.length} found</span>}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="installed-game-list" ref={listRef}>
          {filteredSuggestions.length > 0 && (
            <div className="installed-game-head" aria-hidden="true">
              <span />
              <span>Game</span>
              <span>Notes</span>
              <span>Status</span>
            </div>
          )}
          {pending && <LoadingState label="Scanning installed games..." />}
          {filteredSuggestions.map((suggestion) => {
            const status = suggestionStatus(suggestion.status);
            return (
              <button
                key={suggestion.suggestionId}
                className={`installed-game-row${focusId === suggestion.suggestionId ? ' controller-focused' : ''}`}
                type="button"
                data-suggestion-id={suggestion.suggestionId}
                disabled={suggestion.status === 'unsupported'}
                onFocus={() => setFocusId(suggestion.suggestionId)}
                onBlur={() => setFocusId((current) => (current === suggestion.suggestionId ? '' : current))}
                onClick={() => props.onSelect(suggestion)}
              >
                <GameThumb path={suggestion.iconPath} title={suggestion.title} />
                <span className="installed-game-copy">
                  <strong>{suggestion.title}</strong>
                  <span>
                    {suggestion.source} · {suggestion.launchMethod}
                  </span>
                </span>
                <span className="installed-game-notes" title={suggestion.notes}>{suggestion.notes}</span>
                <StatusText tone={status.tone}>{status.label}</StatusText>
              </button>
            );
          })}
          {!pending && filteredSuggestions.length === 0 && (
            <EmptyState title="No installed games matched your search">
              Try a shorter name, or browse for the game executable manually.
            </EmptyState>
          )}
        </div>
        <ControllerHints
          className="installed-picker-hints"
          hints={[
            { glyph: 'dpad-vertical', label: 'Move' },
            { glyph: 'cross', label: 'Select' },
            { glyph: 'circle', label: 'Close' }
          ]}
        />
      </section>
    </div>
  );
}

function AssetField(props: {
  id: string;
  kind: 'avatar' | 'cover';
  label: string;
  note: string;
  value: string;
  fallback: string;
  browseLabel: string;
  browsing: boolean;
  onChange: (value: string) => void;
  onBrowse: () => void;
}): JSX.Element {
  const previewPath = props.value || props.fallback;
  const usingFallback = !props.value && Boolean(props.fallback);
  return (
    <div className={`asset-field asset-field--${props.kind}`}>
      <ArtImage
        className={`asset-preview asset-preview--${props.kind}`}
        path={previewPath}
        alt={`Selected ${props.kind} preview`}
        fallback={<span className="asset-placeholder" title="No artwork"><ImageIcon size={16} aria-label="No artwork" /></span>}
      />
      <Field
        htmlFor={props.id}
        label={(
          <>
            {props.label}
            {usingFallback && <Badge>Using {props.kind === 'avatar' ? 'cover' : 'avatar'}</Badge>}
          </>
        )}
        help={props.note}
      >
        <div className="input-with-button">
          <input
            id={props.id}
            value={props.value}
            placeholder="No image selected"
            onChange={(event) => props.onChange(event.target.value)}
          />
          <button
            className="admin-btn game-browse"
            type="button"
            aria-label={props.browseLabel}
            disabled={props.browsing}
            onClick={props.onBrowse}
          >
            <ImageIcon size={15} />
            {props.browsing ? 'Browsing...' : 'Browse'}
          </button>
        </div>
      </Field>
    </div>
  );
}

/** One group of the game editor: a 13px label on the left (above, when narrow) and its fields. */
function FormGroup(props: { title: string; children: ReactNode; className?: string }): JSX.Element {
  return (
    <section className={`game-form-group${props.className ? ` ${props.className}` : ''}`} aria-label={props.title}>
      <h3 className="admin-subheading game-form-group-title">{props.title}</h3>
      <div className="game-form-group-body">{props.children}</div>
    </section>
  );
}

function GameForm(props: {
  form: GameInput;
  onChange: <K extends keyof GameInput>(key: K, value: GameInput[K]) => void;
}): JSX.Element {
  const [picking, setPicking] = useState<'avatar' | 'cover' | 'exe' | 'folder' | null>(null);
  const [pickerError, setPickerError] = useState('');
  const sourceValue = SOURCE_OPTIONS.includes((props.form.source ?? '') as (typeof SOURCE_OPTIONS)[number])
    ? props.form.source
    : 'Manual';

  const pickImage = async (imageKind: 'avatar' | 'cover'): Promise<void> => {
    setPicking(imageKind);
    setPickerError('');
    try {
      const result = await window.nxgs.selectImageFile(imageKind);
      if (result.canceled) {
        return;
      }
      if (result.error || !result.path) {
        setPickerError(result.error ?? 'No image file was selected.');
        return;
      }
      props.onChange(imageKind === 'avatar' ? 'avatarImagePath' : 'coverImagePath', result.path);
    } finally {
      setPicking(null);
    }
  };

  const pickExecutable = async (): Promise<void> => {
    setPicking('exe');
    setPickerError('');
    try {
      const result = await window.nxgs.selectExecutableFile();
      if (result.canceled) {
        return;
      }
      if (result.error || !result.path) {
        setPickerError(result.error ?? 'No executable file was selected.');
        return;
      }
      props.onChange('launchCommand', result.path);
      if (result.fileName) {
        props.onChange('processName', result.fileName);
      }
      if (!props.form.workingDirectory?.trim() && result.directory) {
        props.onChange('workingDirectory', result.directory);
      }
    } finally {
      setPicking(null);
    }
  };

  const pickFolder = async (): Promise<void> => {
    setPicking('folder');
    setPickerError('');
    try {
      const result = await window.nxgs.selectFolder();
      if (result.canceled) {
        return;
      }
      if (result.error || !result.path) {
        setPickerError(result.error ?? 'No folder was selected.');
        return;
      }
      props.onChange('workingDirectory', result.path);
    } finally {
      setPicking(null);
    }
  };

  const launchHelp = props.form.launchType === 'localExe'
    ? 'Use manual EXE browsing only when the game is not detected.'
    : props.form.launchType === 'microsoftStore'
      ? 'Use the app identifier from Choose installed game. No hidden executable path is required.'
      : undefined;

  return (
    <div className="game-form">
      <FormGroup title="Details">
        <div className="form-grid">
          <Field label="Game title" required>
            <input
              value={props.form.title}
              placeholder="Name shown to customers"
              onChange={(event) => props.onChange('title', event.target.value)}
            />
          </Field>
          <Field label="Source">
            <select value={sourceValue} onChange={(event) => props.onChange('source', event.target.value)}>
              {SOURCE_OPTIONS.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </FormGroup>

      <FormGroup title="Artwork">
        <div className="game-assets">
          <AssetField
            id="avatar-image-path"
            kind="avatar"
            label="Avatar image path"
            note="Square artwork for the customer game row. Falls back to the cover image."
            value={props.form.avatarImagePath ?? ''}
            fallback={props.form.coverImagePath ?? ''}
            browseLabel="Browse avatar"
            browsing={picking === 'avatar'}
            onChange={(value) => props.onChange('avatarImagePath', value)}
            onBrowse={() => void pickImage('avatar')}
          />
          <AssetField
            id="cover-image-path"
            kind="cover"
            label="Cover / background image path"
            note="Wide 16:9 artwork for the console background. Falls back to the avatar image."
            value={props.form.coverImagePath ?? ''}
            fallback={props.form.avatarImagePath ?? ''}
            browseLabel="Browse cover"
            browsing={picking === 'cover'}
            onChange={(value) => props.onChange('coverImagePath', value)}
            onBrowse={() => void pickImage('cover')}
          />
        </div>
      </FormGroup>

      <FormGroup title="Launch">
        <div className="form-grid">
          <Field label="Launch type" required>
            <select value={props.form.launchType} onChange={(event) => props.onChange('launchType', event.target.value as LaunchType)}>
              <option value="steam">Steam game</option>
              <option value="epic">Epic game</option>
              <option value="microsoftStore">Microsoft Store app</option>
              <option value="localExe">Local executable</option>
              <option value="custom">Custom command</option>
            </select>
          </Field>
          <Field label="Process name to monitor">
            <input
              value={props.form.processName ?? ''}
              placeholder="game.exe"
              onChange={(event) => props.onChange('processName', event.target.value)}
            />
          </Field>
          <Field className="full" label="Launch command" htmlFor="launch-command" required help={launchHelp}>
            <div className="input-with-button">
              <input
                id="launch-command"
                value={props.form.launchCommand}
                placeholder="Path, URI or app identifier"
                onChange={(event) => props.onChange('launchCommand', event.target.value)}
              />
              {props.form.launchType === 'localExe' && (
                <button className="admin-btn game-browse" type="button" disabled={picking === 'exe'} onClick={() => void pickExecutable()}>
                  <FileUp size={15} />
                  {picking === 'exe' ? 'Browsing...' : 'Browse EXE'}
                </button>
              )}
            </div>
          </Field>
          <Field className="full" label="Working directory" htmlFor="working-directory">
            <div className="input-with-button">
              <input
                id="working-directory"
                value={props.form.workingDirectory ?? ''}
                placeholder="Folder the game starts in"
                onChange={(event) => props.onChange('workingDirectory', event.target.value)}
              />
              <button className="admin-btn game-browse" type="button" disabled={picking === 'folder'} onClick={() => void pickFolder()}>
                <FolderOpen size={15} />
                {picking === 'folder' ? 'Browsing...' : 'Browse folder'}
              </button>
            </div>
          </Field>
        </div>
        {pickerError && <Notice tone="error">{pickerError}</Notice>}
      </FormGroup>

      <FormGroup title="Home screen" className="game-form-group--switch">
        <SwitchRow
          label="Enabled on customer home screen"
          description="Show this game in the customer game row on Home."
          checked={props.form.enabled ?? true}
          onChange={(checked) => props.onChange('enabled', checked)}
        />
      </FormGroup>
    </div>
  );
}

export function ScanPanel(props: { currentDevice: DeviceRecord; onGamesChanged: (games: GameRecord[]) => void }): JSX.Element {
  const [suggestions, setSuggestions] = useState<GameSuggestion[]>([]);
  const [pendingScan, setPendingScan] = useState(false);
  const [scannedAt, setScannedAt] = useState<Date | null>(null);
  const [filter, setFilter] = useState<ScanFilter>('all');
  const [savingId, setSavingId] = useState('');
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [error, setError] = useState('');

  const runScan = useCallback(async (): Promise<void> => {
    setPendingScan(true);
    setError('');
    try {
      setSuggestions(await window.nxgs.scanInstalledGames());
      setScannedAt(new Date());
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : String(scanError));
    } finally {
      setPendingScan(false);
    }
  }, []);

  const saveSuggestion = async (suggestion: GameSuggestion): Promise<void> => {
    setSavingId(suggestion.suggestionId);
    setError('');
    try {
      const result = await window.nxgs.saveGame(suggestion);
      props.onGamesChanged(result.games);
      setSavedIds((current) => (current.includes(suggestion.suggestionId) ? current : [...current, suggestion.suggestionId]));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingId('');
    }
  };

  const countOf = (status: ScanFilter): number =>
    status === 'all' ? suggestions.length : suggestions.filter((suggestion) => suggestion.status === status).length;
  const filterOption = (value: ScanFilter, label: string) => ({
    value,
    label: (
      <>
        {label}
        <span className="scan-filter-count">{countOf(value)}</span>
      </>
    )
  });
  const visibleSuggestions = filter === 'all' ? suggestions : suggestions.filter((suggestion) => suggestion.status === filter);

  return (
    <>
      <PageActions>
        <button className="admin-btn admin-btn--primary scan-button" type="button" disabled={pendingScan} onClick={() => void runScan()}>
          {pendingScan ? <LoaderCircle className="spin" size={15} /> : <ScanSearch size={15} />}
          {pendingScan ? 'Scanning...' : scannedAt ? 'Scan again' : 'Scan'}
        </button>
      </PageActions>

      <PageSection
        className="scan-section"
        title="Scan results"
        description={`Suggestions only: nothing is added until you choose Add. Saved results will belong to ${props.currentDevice.name}.`}
      >
        {error && <Notice tone="error">{error}</Notice>}

        {suggestions.length > 0 && (
          <>
            <Toolbar aria-label="Filter scan results">
              <Segmented<ScanFilter>
                aria-label="Show"
                value={filter}
                onChange={setFilter}
                options={[
                  filterOption('all', 'All'),
                  filterOption('ready', 'Ready'),
                  filterOption('needs-confirmation', 'Needs confirmation'),
                  filterOption('unsupported', 'Unsupported')
                ]}
              />
              <ToolbarSpacer />
              <span className="admin-count">
                {savedIds.length > 0 && `${savedIds.length} added · `}
                {scannedAt && `Last scan ${timeLabel(scannedAt.toISOString())}`}
              </span>
            </Toolbar>

            <div className="admin-table-scroll scan-table-scroll">
              <table className="admin-table scan-table">
                <colgroup>
                  <col />
                  <col className="scan-col-source" />
                  <col className="scan-col-confidence" />
                  <col className="scan-col-status" />
                  <col className="scan-col-action" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Game</th>
                    <th scope="col">Source</th>
                    <th scope="col">Confidence</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="admin-num"><span className="admin-visually-hidden">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSuggestions.map((suggestion) => {
                    const saving = savingId === suggestion.suggestionId;
                    const saved = savedIds.includes(suggestion.suggestionId);
                    const status = suggestionStatus(suggestion.status);
                    return (
                      <tr key={suggestion.suggestionId} className={suggestion.status === 'unsupported' ? 'is-unsupported' : undefined}>
                        <td>
                          <div className="scan-game">
                            <GameThumb path={suggestion.iconPath || suggestion.avatarImagePath} title={suggestion.title} />
                            <div className="scan-game-copy">
                              <strong title={suggestion.title}>{suggestion.title}</strong>
                              <span title={suggestion.notes}>{suggestion.notes}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="scan-source">
                            <span>{suggestion.source}</span>
                            <span>{suggestion.launchMethod}</span>
                          </div>
                        </td>
                        <td><Confidence value={suggestion.confidence} /></td>
                        <td><StatusText tone={status.tone}>{status.label}</StatusText></td>
                        <td className="admin-num">
                          {saved ? (
                            <StatusText tone="success">In library</StatusText>
                          ) : (
                            <button
                              className="admin-btn admin-btn--sm scan-add"
                              type="button"
                              aria-label={`Add ${suggestion.title} to the library`}
                              disabled={saving}
                              onClick={() => void saveSuggestion(suggestion)}
                            >
                              {saving ? <LoaderCircle className="spin" size={14} /> : <Plus size={14} />}
                              {saving ? 'Adding...' : 'Add'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visibleSuggestions.length === 0 && (
                <EmptyState title="No results with this status">Choose All to see every result from the last scan.</EmptyState>
              )}
            </div>
          </>
        )}

        {pendingScan && suggestions.length === 0 && (
          <Panel className="scan-placeholder">
            <LoadingState label="Scanning installed games..." />
          </Panel>
        )}
        {!pendingScan && suggestions.length === 0 && (
          <Panel className="scan-placeholder">
            <EmptyState
              title={scannedAt ? 'No installed games found' : 'No scan results yet'}
              action={scannedAt ? undefined : (
                <button className="admin-btn" type="button" onClick={() => void runScan()}>
                  <ScanSearch size={15} />
                  Scan now
                </button>
              )}
            >
              {scannedAt
                ? 'The scan finished without finding Steam, Epic, Microsoft Store or local games. Add a game manually from Games instead.'
                : 'Run a scan to detect games installed on this device. Nothing is added to the library until you add a result.'}
            </EmptyState>
          </Panel>
        )}
      </PageSection>
    </>
  );
}
