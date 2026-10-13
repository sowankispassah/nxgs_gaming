import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  CloudDownload,
  FileUp,
  Info,
  LoaderCircle,
  Power,
  RefreshCw
} from 'lucide-react';
import type { InitialData, UpdateCheckResult, UpdateDownloadProgress } from '../../../shared/types';
import { useControllerNavigation, type ControllerNavigationEvent } from '../../controllerNavigation';
import { ControllerHints } from '../../ui/ControllerHints';
import { playUiSound } from '../../ui/uiSound';
import { Notice } from './AdminKit';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdatePanel(props: { initialData: InitialData }): JSX.Element {
  const [pendingAction, setPendingAction] = useState<'check' | 'download' | 'install' | null>(null);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [downloadedInstallerPath, setDownloadedInstallerPath] = useState('');
  const [downloadedInstallerSha256, setDownloadedInstallerSha256] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<UpdateDownloadProgress | null>(null);
  const [restartPromptOpen, setRestartPromptOpen] = useState(false);
  const [restartPromptIndex, setRestartPromptIndex] = useState(0);
  const [operationMessage, setOperationMessage] = useState('');
  const [operationOk, setOperationOk] = useState(true);
  const laterRef = useRef<HTMLButtonElement>(null);
  const restartRef = useRef<HTMLButtonElement>(null);
  const restartInstallRef = useRef<HTMLButtonElement>(null);
  const promptWasOpen = useRef(false);

  const pending = pendingAction !== null;
  const checking = pendingAction === 'check';
  const progressPercent = downloadProgress?.percent ?? 0;
  const downloadFailed = Boolean(
    downloadProgress && operationMessage && !operationOk && !downloadedInstallerPath && pendingAction !== 'download'
  );
  const downloadProgressLabel =
    pendingAction === 'download' ? 'Downloading update...' : downloadFailed ? 'Download failed' : 'Download complete';
  const statusTone = checking ? 'checking' : result?.status ?? 'idle';

  useEffect(() => window.nxgs.onUpdateDownloadProgress(setDownloadProgress), []);

  const installDownloadedUpdate = async (): Promise<void> => {
    if (!downloadedInstallerPath) {
      setOperationMessage('No downloaded update installer is available.');
      setOperationOk(false);
      return;
    }

    setPendingAction('install');
    setOperationMessage('');
    setOperationOk(true);
    try {
      const install = await window.nxgs.installUpdate({
        installerPath: downloadedInstallerPath,
        sha256: downloadedInstallerSha256 || result?.sha256
      });
      setOperationMessage(install.message);
      setOperationOk(install.ok);
    } finally {
      setPendingAction(null);
    }
  };

  const focusPromptButton = (index: number): void => {
    setRestartPromptIndex(index);
    (index === 0 ? laterRef : restartRef).current?.focus({ preventScroll: true });
  };

  const handleUpdatePromptControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    if (event.type === 'back') {
      playUiSound('back');
      setRestartPromptOpen(false);
    } else if (event.type === 'accept') {
      playUiSound('select');
      if (restartPromptIndex === 0) setRestartPromptOpen(false);
      else void installDownloadedUpdate();
    } else {
      const index = event.direction === 'left' || event.direction === 'up' ? 0 : 1;
      if (index !== restartPromptIndex) playUiSound('move');
      setRestartPromptIndex(index);
    }
  }, [installDownloadedUpdate, restartPromptIndex]);

  useControllerNavigation(restartPromptOpen && !pending, handleUpdatePromptControllerEvent);

  const promptState = useRef({ pending, restartPromptIndex, focusPromptButton });
  promptState.current = { pending, restartPromptIndex, focusPromptButton };

  useEffect(() => {
    if (!restartPromptOpen) return undefined;
    const state = promptState.current;
    (state.restartPromptIndex === 0 ? laterRef : restartRef).current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const isArrow = ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key);
      const isBack = ['Escape', 'b', 'B', 'Backspace'].includes(event.key);
      if (!isArrow && !isBack) return;
      event.preventDefault();
      event.stopPropagation();
      if (promptState.current.pending) return;
      if (isBack) {
        playUiSound('back');
        setRestartPromptOpen(false);
        return;
      }
      const index = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? 0 : 1;
      if (index !== promptState.current.restartPromptIndex) playUiSound('move');
      promptState.current.focusPromptButton(index);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [restartPromptOpen]);

  useEffect(() => {
    if (promptWasOpen.current && !restartPromptOpen) restartInstallRef.current?.focus({ preventScroll: true });
    promptWasOpen.current = restartPromptOpen;
  }, [restartPromptOpen]);

  const statusIcon = checking ? (
    <LoaderCircle size={24} className="spin" />
  ) : result?.status === 'available' ? (
    <CloudDownload size={24} />
  ) : result?.status === 'latest' ? (
    <CircleCheck size={24} />
  ) : result?.status === 'failed' ? (
    <CircleAlert size={24} />
  ) : (
    <Info size={24} />
  );

  return (
    <>
      <div className="admin-stack update-panel">
        <section className="admin-card update-version-card">
          <div className="version-block">
            <span className="version-icon" aria-hidden="true">
              <RefreshCw size={26} />
            </span>
            <div className="version-copy">
              <span>Current app version</span>
              <strong>{props.initialData.appVersion}</strong>
            </div>
            <button
              className="primary-action check-updates-button"
              type="button"
              disabled={pending}
              onClick={async () => {
                setPendingAction('check');
                setOperationMessage('');
                setOperationOk(true);
                setDownloadedInstallerPath('');
                setDownloadProgress(null);
                setRestartPromptOpen(false);
                try {
                  setResult(await window.nxgs.checkForUpdates());
                } finally {
                  setPendingAction(null);
                }
              }}
            >
              {checking ? <LoaderCircle size={19} className="spin" /> : <RefreshCw size={19} />}
              {checking ? 'Checking for updates...' : 'Check for Updates'}
            </button>
          </div>
          <p className="muted update-intro">
            NXGS Play checks the release manifest for a newer packaged installer. The app stays open while the update downloads,
            then asks you to restart when the installer is ready.
          </p>
        </section>

        <section className={`admin-card update-status ${statusTone}`} aria-live="polite">
          <div className="update-status-head">
            <span className="update-status-icon" aria-hidden="true">{statusIcon}</span>
            {checking ? (
              <div className="update-status-copy">
                <strong>Checking for updates...</strong>
                <span>Contacting the NXGS release manifest.</span>
              </div>
            ) : result ? (
              <div className="update-status-copy">
                <strong>
                  {result.status === 'available'
                    ? 'New update available'
                    : result.status === 'latest'
                      ? 'You are on the latest version'
                      : 'Update check failed'}
                </strong>
                <span>{result.message}</span>
              </div>
            ) : (
              <div className="update-status-copy">
                <strong>No update check has been run yet.</strong>
                <span>Use Check for Updates to look for a newer NXGS Play release.</span>
              </div>
            )}
            {!checking && result?.latestVersion && (
              <span className={`ps-chip ${result.status === 'available' ? 'ps-chip--accent' : ''}`}>v{result.latestVersion}</span>
            )}
          </div>

          {!checking && result && (
            <dl className="admin-meta-list update-details">
              {result.latestVersion && (
                <div>
                  <dt>Latest version</dt>
                  <dd>{result.latestVersion}</dd>
                </div>
              )}
              {result.assetName && (
                <div>
                  <dt>Installer asset</dt>
                  <dd>{result.assetName}</dd>
                </div>
              )}
              {result.notes && (
                <div>
                  <dt>Release notes</dt>
                  <dd>{result.notes}</dd>
                </div>
              )}
              <div>
                <dt>Checked at</dt>
                <dd>{new Date(result.checkedAt).toLocaleString()}</dd>
              </div>
            </dl>
          )}

          {!checking && result?.releaseUrl && (
            <a className="update-release-link" href={result.releaseUrl} target="_blank" rel="noreferrer">
              View GitHub release
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          )}

          {result?.status === 'available' && result.canDownload && result.downloadUrl && !downloadedInstallerPath && (
            <button
              className="primary-action wide"
              type="button"
              disabled={pending}
              onClick={async () => {
                setPendingAction('download');
                setOperationMessage('');
                setOperationOk(true);
                setDownloadProgress({ receivedBytes: 0, percent: 0 });
                try {
                  const download = await window.nxgs.downloadUpdate({
                    downloadUrl: result.downloadUrl ?? '',
                    assetName: result.assetName,
                    sha256: result.sha256,
                    latestVersion: result.latestVersion
                  });
                  setOperationMessage(download.message);
                  setOperationOk(download.ok);
                  if (download.ok && download.installerPath) {
                    setDownloadedInstallerPath(download.installerPath);
                    setDownloadedInstallerSha256(download.sha256 ?? result.sha256 ?? '');
                    setRestartPromptOpen(true);
                  }
                } finally {
                  setPendingAction(null);
                }
              }}
            >
              {pendingAction === 'download' ? <LoaderCircle size={19} className="spin" /> : <FileUp size={19} />}
              {pendingAction === 'download' ? `Downloading update${progressPercent > 0 ? ` ${progressPercent}%` : '...'}` : 'Download Update'}
            </button>
          )}

          {(pendingAction === 'download' || downloadProgress) && (
            <div className={`download-progress ${downloadFailed ? 'failed' : ''}`}>
              <div className="download-progress-head">
                <span>{downloadProgressLabel}</span>
                <strong>{progressPercent}%</strong>
              </div>
              <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
                <span style={{ width: `${progressPercent}%` }} />
              </div>
              {downloadProgress?.totalBytes ? (
                <small>
                  {formatBytes(downloadProgress.receivedBytes)} of {formatBytes(downloadProgress.totalBytes)}
                </small>
              ) : null}
            </div>
          )}

          {downloadedInstallerPath && (
            <div className="update-actions">
              <button
                ref={restartInstallRef}
                className="primary-action wide"
                type="button"
                disabled={pending}
                onClick={() => setRestartPromptOpen(true)}
              >
                <Power size={19} />
                Restart to Install Update
              </button>
            </div>
          )}

          {operationMessage && <Notice tone={operationOk ? 'success' : 'error'}>{operationMessage}</Notice>}
        </section>
      </div>

      {restartPromptOpen && (
        <div className="modal-backdrop">
          <div className="modal update-modal" role="dialog" aria-modal="true" aria-labelledby="update-modal-title">
            <span className="update-modal-icon" aria-hidden="true">
              <CloudDownload size={28} />
            </span>
            <div className="update-modal-copy">
              <p className="eyebrow">Update ready</p>
              <h2 id="update-modal-title">Restart to finish update</h2>
              <p className="muted">
                Version {result?.latestVersion ?? 'the new update'} is downloaded. NXGS Play will stay open until you choose
                Restart Now.
              </p>
            </div>
            <div className="update-restart-note">
              Restart Now closes NXGS Play, runs the verified installer, and reopens the app after installation.
            </div>
            <div className="update-modal-footer">
              <ControllerHints
                className="update-modal-hints"
                hints={[
                  { glyph: 'cross', label: 'Select' },
                  { glyph: 'circle', label: 'Later' }
                ]}
              />
              <div className="update-modal-actions">
                <button
                  ref={laterRef}
                  className={`secondary-action ${restartPromptIndex === 0 ? 'controller-focused' : ''}`}
                  type="button"
                  disabled={pendingAction === 'install'}
                  onFocus={() => setRestartPromptIndex(0)}
                  onClick={() => setRestartPromptOpen(false)}
                >
                  Later
                </button>
                <button
                  ref={restartRef}
                  className={`primary-action ${restartPromptIndex === 1 ? 'controller-focused' : ''}`}
                  type="button"
                  disabled={pendingAction === 'install'}
                  onFocus={() => setRestartPromptIndex(1)}
                  onClick={installDownloadedUpdate}
                >
                  {pendingAction === 'install' ? <LoaderCircle size={18} className="spin" /> : <Power size={18} />}
                  {pendingAction === 'install' ? 'Restarting...' : 'Restart Now'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
