import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  FileUp,
  FolderOpen,
  Gamepad2,
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
  CardHeader,
  EmptyState,
  LoadingState,
  Notice,
  revealInContent,
  SwitchRow,
  type NoticeTone
} from './AdminKit';

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

function suggestionStatusLabel(status: GameSuggestion['status']): string {
  if (status === 'ready') {
    return 'ready';
  }
  if (status === 'needs-confirmation') {
    return 'needs confirmation';
  }
  return 'unsupported';
}

function suggestionChipTone(status: GameSuggestion['status']): string {
  if (status === 'ready') return 'ps-chip--success';
  if (status === 'needs-confirmation') return 'ps-chip--warning';
  return 'ps-chip--danger';
}

function gameStatus(game: GameRecord): { label: string; tone: string } {
  if (!game.enabled || game.availabilityStatus === 'disabled') return { label: 'Disabled', tone: '' };
  if (game.availabilityStatus === 'available') return { label: 'Available', tone: 'ps-chip--success' };
  if (game.availabilityStatus === 'missing') return { label: 'Missing', tone: 'ps-chip--danger' };
  return { label: 'Unknown', tone: 'ps-chip--warning' };
}

function normalizeForm(game?: GameRecord | GameInput): GameInput {
  return {
    ...EMPTY_GAME,
    ...(game ?? {})
  };
}

export function GameManager(props: { currentDevice: DeviceRecord; games: GameRecord[]; onGamesChanged: (games: GameRecord[]) => void }): JSX.Element {
  const [form, setForm] = useState<GameInput>(EMPTY_GAME);
  const [pending, setPending] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [message, setMessage] = useState<FormMessage>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const editorRef = useRef<HTMLElement>(null);
  const chooseButtonRef = useRef<HTMLButtonElement>(null);

  const closePicker = (): void => {
    setPickerOpen(false);
    chooseButtonRef.current?.focus({ preventScroll: true });
  };

  const update = <K extends keyof GameInput>(key: K, value: GameInput[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
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

  return (
    <div className="admin-columns admin-columns--library">
      <section className="admin-card game-list-panel">
        <CardHeader
          eyebrow="Library"
          title="Customer games"
          subtitle={`Only games linked to ${props.currentDevice.name}`}
          actions={<span className="ps-chip admin-count-chip">{props.games.length} saved</span>}
        />
        {props.games.length === 0 ? (
          <EmptyState icon={<Gamepad2 size={28} />} title="No games linked yet">
            Use Choose Installed Game to add the first game to this station.
          </EmptyState>
        ) : (
          <ul className="admin-list game-list">
            {props.games.map((game) => {
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
                    <ArtImage
                      className="row-art"
                      path={game.avatarImagePath || game.coverImagePath}
                      fallback={<Gamepad2 size={22} />}
                    />
                    <span className="row-copy">
                      <strong>{game.title}</strong>
                      <span className="row-chips">
                        <span className="ps-chip">{launchTypeLabel(game.launchType)}</span>
                        <span className={`ps-chip ${status.tone}`}>{status.label}</span>
                      </span>
                    </span>
                  </button>
                  <button
                    className="icon-button danger row-icon-action"
                    type="button"
                    title="Delete game"
                    aria-label={`Delete ${game.title}`}
                    disabled={deletingId === game.id}
                    onClick={() => void deleteGame(game)}
                  >
                    {deletingId === game.id ? <LoaderCircle className="spin" size={18} /> : <Trash2 size={18} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="admin-card game-editor-panel" ref={editorRef}>
        <CardHeader
          eyebrow="Game linking"
          title={form.id ? 'Edit game' : 'Add game'}
          subtitle={form.id ? `Editing ${form.title || 'an untitled game'} on ${props.currentDevice.name}` : `New games are linked to ${props.currentDevice.name}`}
          actions={(
            <button
              className="secondary-action compact"
              type="button"
              title="New game"
              onClick={() => {
                setForm(EMPTY_GAME);
                setMessage(null);
              }}
            >
              <Plus size={17} />
              New game
            </button>
          )}
        />
        <div className="linking-actions">
          <button ref={chooseButtonRef} className="primary-action" type="button" onClick={() => setPickerOpen(true)}>
            <Search size={19} />
            Choose Installed Game
          </button>
          <span className="muted">Use manual EXE browsing only when the game is not detected.</span>
        </div>
        <GameForm form={form} onChange={update} />
        <footer className="admin-card-footer">
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : <span aria-hidden="true" />}
          <button className="primary-action" type="button" disabled={pending} onClick={() => void saveGame()}>
            {pending ? <LoaderCircle className="spin" size={19} /> : <Save size={19} />}
            {pending ? 'Saving...' : 'Save Game'}
          </button>
        </footer>
      </section>

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
      <section className="modal installed-picker-modal" role="dialog" aria-modal="true" aria-labelledby="installed-picker-title">
        <button className="icon-button close-button" type="button" title="Close" onClick={props.onClose} disabled={pending}>
          <X size={20} />
        </button>
        <header className="installed-picker-header">
          <p className="eyebrow">Detected apps and games</p>
          <h2 id="installed-picker-title">Choose Installed Game</h2>
        </header>
        <div className="installed-picker-toolbar">
          <label className="picker-search">
            <Search size={19} aria-hidden="true" />
            <input
              ref={searchRef}
              autoFocus
              placeholder="Search installed games, for example Chicken Invaders"
              value={query}
              onFocus={() => setFocusId('')}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {!pending && <span className="ps-chip admin-count-chip">{filteredSuggestions.length} found</span>}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="installed-game-list" ref={listRef}>
          {pending && <LoadingState label="Scanning installed games..." />}
          {filteredSuggestions.map((suggestion) => (
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
              <ArtImage className="installed-game-icon" path={suggestion.iconPath} fallback={<Gamepad2 size={22} />} />
              <span className="installed-game-copy">
                <strong>{suggestion.title}</strong>
                <span>
                  {suggestion.source} · {suggestion.launchMethod}
                </span>
                <small>{suggestion.notes}</small>
              </span>
              <em className={`picker-status ps-chip ${suggestionChipTone(suggestion.status)}`}>{suggestionStatusLabel(suggestion.status)}</em>
            </button>
          ))}
          {!pending && filteredSuggestions.length === 0 && (
            <EmptyState icon={<Search size={26} />} title="No installed games matched your search.">
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
  return (
    <div className={`asset-field asset-field--${props.kind}`}>
      <div className={`asset-preview ${props.kind}-preview`}>
        <ArtImage
          className="asset-preview-art"
          path={previewPath}
          alt={`Selected ${props.kind} preview`}
          fallback={(
            <span className="asset-placeholder">
              <ImageIcon size={24} />
              <small>No artwork</small>
            </span>
          )}
        />
        {!props.value && props.fallback && (
          <span className="asset-fallback-chip">Using {props.kind === 'avatar' ? 'cover' : 'avatar'}</span>
        )}
      </div>
      <div className="asset-body">
        <label className="admin-field-label" htmlFor={props.id}>{props.label}</label>
        <input
          id={props.id}
          value={props.value}
          placeholder="No image selected"
          onChange={(event) => props.onChange(event.target.value)}
        />
        <div className="asset-actions">
          <button className="secondary-action compact browse-button" type="button" disabled={props.browsing} onClick={props.onBrowse}>
            <ImageIcon size={17} />
            {props.browsing ? 'Browsing...' : props.browseLabel}
          </button>
          <small className="field-note">{props.note}</small>
        </div>
      </div>
    </div>
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

  return (
    <div className="admin-form game-form">
      <section className="admin-form-section">
        <h3 className="admin-section-title">Details</h3>
        <div className="form-grid">
          <label className="admin-field">
            <span className="admin-field-label">
              Game title <em className="required-badge">Required</em>
            </span>
            <input
              value={props.form.title}
              placeholder="Name shown to customers"
              onChange={(event) => props.onChange('title', event.target.value)}
            />
          </label>
          <label className="admin-field">
            <span className="admin-field-label">Source</span>
            <select value={sourceValue} onChange={(event) => props.onChange('source', event.target.value)}>
              {SOURCE_OPTIONS.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="admin-form-section">
        <h3 className="admin-section-title">Artwork</h3>
        <div className="game-assets">
          <AssetField
            id="avatar-image-path"
            kind="avatar"
            label="Avatar image path"
            note="Square artwork for the customer game row. Falls back to the cover image."
            value={props.form.avatarImagePath ?? ''}
            fallback={props.form.coverImagePath ?? ''}
            browseLabel="Browse Avatar"
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
            browseLabel="Browse Cover"
            browsing={picking === 'cover'}
            onChange={(value) => props.onChange('coverImagePath', value)}
            onBrowse={() => void pickImage('cover')}
          />
        </div>
      </section>

      <section className="admin-form-section">
        <h3 className="admin-section-title">Launch</h3>
        <div className="form-grid">
          <label className="admin-field">
            <span className="admin-field-label">
              Launch type <em className="required-badge">Required</em>
            </span>
            <select value={props.form.launchType} onChange={(event) => props.onChange('launchType', event.target.value as LaunchType)}>
              <option value="steam">Steam game</option>
              <option value="epic">Epic game</option>
              <option value="microsoftStore">Microsoft Store app</option>
              <option value="localExe">Local executable</option>
              <option value="custom">Custom command</option>
            </select>
          </label>
          <label className="admin-field">
            <span className="admin-field-label">Process name to monitor</span>
            <input
              value={props.form.processName ?? ''}
              placeholder="game.exe"
              onChange={(event) => props.onChange('processName', event.target.value)}
            />
          </label>
          <div className="admin-field full">
            <label className="admin-field-label" htmlFor="launch-command">
              Launch command <em className="required-badge">Required</em>
            </label>
            <div className="input-with-button">
              <input
                id="launch-command"
                value={props.form.launchCommand}
                placeholder="Path, URI or app identifier"
                onChange={(event) => props.onChange('launchCommand', event.target.value)}
              />
              {props.form.launchType === 'localExe' && (
                <button className="secondary-action browse-button" type="button" disabled={picking === 'exe'} onClick={() => void pickExecutable()}>
                  <FileUp size={18} />
                  {picking === 'exe' ? 'Browsing...' : 'Browse EXE manually'}
                </button>
              )}
            </div>
            {props.form.launchType === 'microsoftStore' && (
              <small className="field-note">Use the app identifier from Choose Installed Game. No hidden executable path is required.</small>
            )}
          </div>
          <div className="admin-field full">
            <label className="admin-field-label" htmlFor="working-directory">Working directory</label>
            <div className="input-with-button">
              <input
                id="working-directory"
                value={props.form.workingDirectory ?? ''}
                placeholder="Folder the game starts in"
                onChange={(event) => props.onChange('workingDirectory', event.target.value)}
              />
              <button className="secondary-action browse-button" type="button" disabled={picking === 'folder'} onClick={() => void pickFolder()}>
                <FolderOpen size={18} />
                {picking === 'folder' ? 'Browsing...' : 'Browse Folder'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {pickerError && <Notice tone="error">{pickerError}</Notice>}

      <SwitchRow
        label="Enabled on customer home screen"
        description="Show this game in the customer game row on Home."
        checked={props.form.enabled ?? true}
        onChange={(checked) => props.onChange('enabled', checked)}
      />
    </div>
  );
}

export function ScanPanel(props: { currentDevice: DeviceRecord; onGamesChanged: (games: GameRecord[]) => void }): JSX.Element {
  const [suggestions, setSuggestions] = useState<GameSuggestion[]>([]);
  const [pendingScan, setPendingScan] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [error, setError] = useState('');

  const runScan = useCallback(async (): Promise<void> => {
    setPendingScan(true);
    setError('');
    try {
      setSuggestions(await window.nxgs.scanInstalledGames());
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

  return (
    <section className="admin-card scan-panel">
      <CardHeader
        eyebrow="Suggestions only"
        title="Scan installed games"
        subtitle={`Saved results will belong to ${props.currentDevice.name}`}
        actions={(
          <button className="primary-action scan-button" type="button" disabled={pendingScan} onClick={() => void runScan()}>
            {pendingScan ? <LoaderCircle className="spin" size={19} /> : <Search size={19} />}
            {pendingScan ? 'Scanning...' : 'Scan'}
          </button>
        )}
      />
      {error && <Notice tone="error">{error}</Notice>}
      {suggestions.length > 0 && (
        <div className="scan-results">
          {suggestions.map((suggestion) => {
            const saving = savingId === suggestion.suggestionId;
            return (
              <article key={suggestion.suggestionId} className="suggestion-row">
                <ArtImage
                  className="row-art"
                  path={suggestion.iconPath || suggestion.avatarImagePath}
                  fallback={<Gamepad2 size={22} />}
                />
                <div className="row-copy">
                  <strong>{suggestion.title}</strong>
                  <span>
                    {suggestion.source} · {suggestion.launchMethod}
                  </span>
                  <small>{suggestion.notes}</small>
                </div>
                <div className="suggestion-side">
                  {savedIds.includes(suggestion.suggestionId) && (
                    <span className="ps-chip ps-chip--success">
                      <Check size={14} />
                      In library
                    </span>
                  )}
                  <span className={`ps-chip ${suggestionChipTone(suggestion.status)}`}>{suggestionStatusLabel(suggestion.status)}</span>
                  <button
                    className="secondary-action compact"
                    type="button"
                    disabled={saving}
                    onClick={() => void saveSuggestion(suggestion)}
                  >
                    {saving ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {pendingScan && suggestions.length === 0 && <LoadingState label="Scanning installed games..." />}
      {!pendingScan && suggestions.length === 0 && (
        <EmptyState icon={<ScanSearch size={28} />} title="No scan results yet.">
          Run a scan to detect games installed on this station. Nothing is added to the library until you save a result.
        </EmptyState>
      )}
    </section>
  );
}
