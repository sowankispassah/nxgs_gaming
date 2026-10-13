import { useEffect, useState } from 'react';
import {
  Check,
  Clock,
  FileUp,
  FolderOpen,
  Gamepad2,
  Image as ImageIcon,
  Plus,
  Save,
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
import { toFileUrl } from '../../ui/media';

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
  const [message, setMessage] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

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
    setMessage(`${suggestion.title} selected. Review and save it to add it to the customer library.`);
  };

  return (
    <div className="admin-grid">
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Game linking</p>
            <h2>{form.id ? 'Edit game' : 'Add game'}</h2>
            <span className="device-context-label">Device: {props.currentDevice.name}</span>
          </div>
          <button className="icon-button" type="button" title="New game" onClick={() => setForm(EMPTY_GAME)}>
            <Plus size={20} />
          </button>
        </div>
        <div className="linking-actions">
          <button className="primary-action" type="button" onClick={() => setPickerOpen(true)}>
            <Search size={19} />
            Choose Installed Game
          </button>
          <span className="muted">Use manual EXE browsing only when the game is not detected.</span>
        </div>
        <GameForm form={form} onChange={update} />
        {message && <p className={message.startsWith('Saved') ? 'success-text' : 'error-text'}>{message}</p>}
        <button
          className="primary-action wide"
          type="button"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setMessage('');
            try {
              const result = await window.nxgs.saveGame(form);
              props.onGamesChanged(result.games);
              setForm(normalizeForm(result.game));
              setMessage('Saved game.');
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error));
            } finally {
              setPending(false);
            }
          }}
        >
          <Save size={19} />
          {pending ? 'Saving...' : 'Save Game'}
        </button>
      </section>

      <section className="panel game-list-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Library</p>
            <h2>{props.games.length} saved</h2>
            <span className="device-context-label">Only games linked to {props.currentDevice.name}</span>
          </div>
        </div>
        <div className="admin-list">
          {props.games.map((game) => (
            <div key={game.id} className="admin-list-row">
              <button type="button" className="row-main" onClick={() => setForm(normalizeForm(game))}>
                <strong>{game.title}</strong>
                <span>{launchTypeLabel(game.launchType)} - {game.enabled ? game.availabilityStatus : 'disabled'}</span>
                <small>Device: {props.currentDevice.name}</small>
              </button>
              <button
                className="icon-button danger"
                type="button"
                title="Delete game"
                disabled={deletingId === game.id}
                onClick={async () => {
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
                }}
              >
                {deletingId === game.id ? <Clock size={18} /> : <Trash2 size={18} />}
              </button>
            </div>
          ))}
        </div>
      </section>
      {pickerOpen && (
        <InstalledGamePicker
          onClose={() => setPickerOpen(false)}
          onSelect={(suggestion) => {
            applySuggestion(suggestion);
            setPickerOpen(false);
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

  return (
    <div className="modal-backdrop">
      <section className="modal installed-picker-modal">
        <button className="icon-button close-button" type="button" title="Close" onClick={props.onClose} disabled={pending}>
          <X size={20} />
        </button>
        <p className="eyebrow">Detected apps and games</p>
        <h2>Choose Installed Game</h2>
        <div className="picker-search">
          <Search size={18} />
          <input
            autoFocus
            placeholder="Search installed games, for example Chicken Invaders"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {pending && <p className="muted">Scanning installed games...</p>}
        {error && <p className="error-text">{error}</p>}
        <div className="installed-game-list">
          {filteredSuggestions.map((suggestion) => (
            <button
              key={suggestion.suggestionId}
              className="installed-game-row"
              type="button"
              disabled={suggestion.status === 'unsupported'}
              onClick={() => props.onSelect(suggestion)}
            >
              <div className="installed-game-icon">
                {suggestion.iconPath ? <img src={toFileUrl(suggestion.iconPath)} alt="" /> : <Gamepad2 size={22} />}
              </div>
              <div>
                <strong>{suggestion.title}</strong>
                <span>
                  {suggestion.source} - {suggestion.launchMethod}
                </span>
                <small>{suggestion.notes}</small>
              </div>
              <em className={`picker-status ${suggestion.status}`}>{suggestionStatusLabel(suggestion.status)}</em>
            </button>
          ))}
          {!pending && filteredSuggestions.length === 0 && <p className="muted">No installed games matched your search.</p>}
        </div>
      </section>
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
    <div className="form-grid">
      <label>
        <span>
          Game title <em className="required-badge">Required</em>
        </span>
        <input value={props.form.title} onChange={(event) => props.onChange('title', event.target.value)} />
      </label>
      <label>
        <span>Source</span>
        <select value={sourceValue} onChange={(event) => props.onChange('source', event.target.value)}>
          {SOURCE_OPTIONS.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </label>
      <div className="game-assets full">
        <div className="form-field asset-field">
          <label htmlFor="avatar-image-path">Avatar image path</label>
          <div className="input-with-button">
            <input
              id="avatar-image-path"
              value={props.form.avatarImagePath ?? ''}
              onChange={(event) => props.onChange('avatarImagePath', event.target.value)}
            />
            <button
              className="secondary-action browse-button"
              type="button"
              disabled={picking === 'avatar'}
              onClick={() => pickImage('avatar')}
            >
              <ImageIcon size={18} />
              {picking === 'avatar' ? 'Browsing...' : 'Browse Avatar'}
            </button>
          </div>
          <small className="field-note">Square artwork for the customer game row. Falls back to the cover image.</small>
          {(props.form.avatarImagePath || props.form.coverImagePath) && (
            <div className="asset-preview avatar-preview">
              <img src={toFileUrl(props.form.avatarImagePath || props.form.coverImagePath || '')} alt="Selected avatar preview" />
            </div>
          )}
        </div>
        <div className="form-field asset-field">
          <label htmlFor="cover-image-path">Cover / background image path</label>
          <div className="input-with-button">
            <input
              id="cover-image-path"
              value={props.form.coverImagePath ?? ''}
              onChange={(event) => props.onChange('coverImagePath', event.target.value)}
            />
            <button
              className="secondary-action browse-button"
              type="button"
              disabled={picking === 'cover'}
              onClick={() => pickImage('cover')}
            >
              <ImageIcon size={18} />
              {picking === 'cover' ? 'Browsing...' : 'Browse Cover'}
            </button>
          </div>
          <small className="field-note">Wide 16:9 artwork for the console background. Falls back to the avatar image.</small>
          {(props.form.coverImagePath || props.form.avatarImagePath) && (
            <div className="asset-preview cover-preview">
              <img src={toFileUrl(props.form.coverImagePath || props.form.avatarImagePath || '')} alt="Selected cover preview" />
            </div>
          )}
        </div>
      </div>
      <label>
        <span>
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
      <label>
        <span>Process name to monitor</span>
        <input value={props.form.processName ?? ''} onChange={(event) => props.onChange('processName', event.target.value)} />
      </label>
      <div className="form-field full">
        <label htmlFor="launch-command">
          Launch command <em className="required-badge">Required</em>
        </label>
        <div className="input-with-button">
          <input
            id="launch-command"
            value={props.form.launchCommand}
            onChange={(event) => props.onChange('launchCommand', event.target.value)}
          />
          {props.form.launchType === 'localExe' && (
            <button className="secondary-action browse-button" type="button" disabled={picking === 'exe'} onClick={pickExecutable}>
              <FileUp size={18} />
              {picking === 'exe' ? 'Browsing...' : 'Browse EXE manually'}
            </button>
          )}
        </div>
        {props.form.launchType === 'microsoftStore' && (
          <small className="field-note">Use the app identifier from Choose Installed Game. No hidden executable path is required.</small>
        )}
      </div>
      <div className="form-field full">
        <label htmlFor="working-directory">Working directory</label>
        <div className="input-with-button">
          <input
            id="working-directory"
            value={props.form.workingDirectory ?? ''}
            onChange={(event) => props.onChange('workingDirectory', event.target.value)}
          />
          <button className="secondary-action browse-button" type="button" disabled={picking === 'folder'} onClick={pickFolder}>
            <FolderOpen size={18} />
            {picking === 'folder' ? 'Browsing...' : 'Browse Folder'}
          </button>
        </div>
      </div>
      {pickerError && <p className="error-text full">{pickerError}</p>}
      <label className="checkbox-row full">
        <input
          type="checkbox"
          checked={props.form.enabled ?? true}
          onChange={(event) => props.onChange('enabled', event.target.checked)}
        />
        <span>Enabled on customer home screen</span>
      </label>
    </div>
  );
}

export function ScanPanel(props: { currentDevice: DeviceRecord; onGamesChanged: (games: GameRecord[]) => void }): JSX.Element {
  const [suggestions, setSuggestions] = useState<GameSuggestion[]>([]);
  const [pendingScan, setPendingScan] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Suggestions only</p>
          <h2>Scan installed games</h2>
          <span className="device-context-label">Saved results will belong to {props.currentDevice.name}</span>
        </div>
        <button
          className="primary-action"
          type="button"
          disabled={pendingScan}
          onClick={async () => {
            setPendingScan(true);
            setError('');
            try {
              setSuggestions(await window.nxgs.scanInstalledGames());
            } catch (scanError) {
              setError(scanError instanceof Error ? scanError.message : String(scanError));
            } finally {
              setPendingScan(false);
            }
          }}
        >
          <Search size={19} />
          {pendingScan ? 'Scanning...' : 'Scan'}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="scan-results">
        {suggestions.map((suggestion) => (
          <article key={suggestion.suggestionId} className="suggestion-row">
            <div>
              <strong>{suggestion.title}</strong>
              <span>
                {suggestion.source} - {suggestion.launchMethod} - {suggestionStatusLabel(suggestion.status)}
              </span>
              <small>{suggestion.notes}</small>
            </div>
            <button
              className="secondary-action"
              type="button"
              disabled={savingId === suggestion.suggestionId}
              onClick={async () => {
                setSavingId(suggestion.suggestionId);
                try {
                  const result = await window.nxgs.saveGame(suggestion);
                  props.onGamesChanged(result.games);
                } finally {
                  setSavingId('');
                }
              }}
            >
              <Check size={18} />
              {savingId === suggestion.suggestionId ? 'Saving...' : 'Save'}
            </button>
          </article>
        ))}
        {!pendingScan && suggestions.length === 0 && <p className="muted">No scan results yet.</p>}
      </div>
    </section>
  );
}
