import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, FileDown, LoaderCircle, Power, RefreshCw } from 'lucide-react';
import type { InitialData, UpdateCheckResult, UpdateDownloadProgress } from '../../../shared/types';
import { useControllerNavigation, type ControllerNavigationEvent } from '../../controllerNavigation';
import { ControllerHints } from '../../ui/ControllerHints';
import { playUiSound } from '../../ui/uiSound';
import { Notice, PageActions, PageSection, Panel } from './AdminKit';
import { dateTimeLabel } from './fleetFormat';

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
  const statusTone = checking ? 'checking' : downloadedInstallerPath ? 'ready' : result?.status ?? 'idle';
  const canDownload = Boolean(result?.status === 'available' && result.canDownload && result.downloadUrl && !downloadedInstallerPath);
  // The status block owns the primary action once there is something to download or install.
  const hasUpdateAction = canDownload || Boolean(downloadedInstallerPath);

  useEffect(() => window.nxgs.onUpdateDownloadProgress(setDownloadProgress), []);

  const checkForUpdates = async (): Promise<void> => {
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
  };

  const downloadUpdate = async (): Promise<void> => {
    if (!result) return;
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
  };

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

  const headline = checking
    ? 'Checking for updates...'
    : downloadedInstallerPath
      ? 'Update downloaded'
      : result?.status === 'available'
      ? 'New update available'
      : result?.status === 'latest'
        ? 'You are on the latest version'
        : result?.status === 'failed'
          ? 'Update check failed'
          : 'Not checked yet';
  const detail = checking
    ? 'Contacting the NXGS release manifest.'
    : downloadedInstallerPath
      ? `Restart NXGS Play to install version ${result?.latestVersion ?? 'the new update'}.`
      : result
      ? result.message
      : 'Use Check for updates to look for a newer NXGS Play release.';

  return (
    <>
      <PageActions>
        <button
          className={`admin-btn${hasUpdateAction ? '' : ' admin-btn--primary'}`}
          type="button"
          disabled={pending}
          onClick={() => void checkForUpdates()}
        >
          {checking ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
          {checking ? 'Checking for updates...' : 'Check for updates'}
        </button>
      </PageActions>

      <div className="admin-stack">
        <PageSection
          title="Software update"
          description="NXGS Play checks the release manifest for a newer installer and stays open while it downloads."
        >
          <Panel padding="rows" className={`update-panel update-panel--${statusTone}`} aria-live="polite">
            <div className="update-summary">
              <div className="update-summary-copy">
                <h3 className="update-headline">
                  {checking ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <i className="update-dot" aria-hidden="true" />}
                  {headline}
                </h3>
                <p className="update-detail">{detail}</p>
              </div>

              {canDownload && (
                <button className="admin-btn admin-btn--primary" type="button" disabled={pending} onClick={() => void downloadUpdate()}>
                  {pendingAction === 'download' ? <LoaderCircle size={15} className="spin" /> : <FileDown size={15} />}
                  {pendingAction === 'download' ? `Downloading update${progressPercent > 0 ? ` ${progressPercent}%` : '...'}` : 'Download update'}
                </button>
              )}

              {downloadedInstallerPath && (
                <button
                  ref={restartInstallRef}
                  className="admin-btn admin-btn--primary"
                  type="button"
                  disabled={pending}
                  onClick={() => setRestartPromptOpen(true)}
                >
                  <Power size={15} />
                  Restart to install update
                </button>
              )}
            </div>

            {(pendingAction === 'download' || downloadProgress) && (
              <div className={`update-progress${downloadFailed ? ' is-failed' : ''}`}>
                <div className="update-progress-head">
                  <span>{downloadProgressLabel}</span>
                  <span className="admin-num">
                    {downloadProgress?.totalBytes
                      ? `${formatBytes(downloadProgress.receivedBytes)} of ${formatBytes(downloadProgress.totalBytes)} · `
                      : ''}
                    {progressPercent}%
                  </span>
                </div>
                <div className="update-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
                  <span style={{ width: `${progressPercent}%` }} />
                </div>
              </div>
            )}

            <dl className="admin-meta-list admin-meta-list--left update-facts">
              <div>
                <dt>Installed version</dt>
                <dd className="update-version">{props.initialData.appVersion}</dd>
              </div>
              {!checking && result?.latestVersion && (
                <div>
                  <dt>Latest version</dt>
                  <dd className="update-version">{result.latestVersion}</dd>
                </div>
              )}
              {!checking && result?.assetName && (
                <div>
                  <dt>Installer</dt>
                  <dd className="admin-mono">{result.assetName}</dd>
                </div>
              )}
              {!checking && result?.notes && (
                <div>
                  <dt>Release notes</dt>
                  <dd>{result.notes}</dd>
                </div>
              )}
              {!checking && result && (
                <div>
                  <dt>Checked at</dt>
                  <dd>{dateTimeLabel(result.checkedAt)}</dd>
                </div>
              )}
              {!checking && result?.releaseUrl && (
                <div>
                  <dt>Release</dt>
                  <dd>
                    <a className="update-release-link" href={result.releaseUrl} target="_blank" rel="noreferrer">
                      View GitHub release
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </Panel>
          {operationMessage && <Notice tone={operationOk ? 'success' : 'error'}>{operationMessage}</Notice>}
        </PageSection>
      </div>

      {restartPromptOpen && (
        <div className="modal-backdrop">
          <div className="modal update-modal" role="dialog" aria-modal="true" aria-labelledby="update-modal-title">
            <div className="update-modal-copy">
              <h2 id="update-modal-title">Restart to finish update</h2>
              <p className="muted">
                Version {result?.latestVersion ?? 'the new update'} is downloaded. NXGS Play will stay open until you choose
                Restart now.
              </p>
              <p className="update-restart-note">
                Restart now closes NXGS Play, runs the verified installer, and reopens the app after installation.
              </p>
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
                  className={`admin-btn ${restartPromptIndex === 0 ? 'controller-focused' : ''}`}
                  type="button"
                  disabled={pendingAction === 'install'}
                  onFocus={() => setRestartPromptIndex(0)}
                  onClick={() => setRestartPromptOpen(false)}
                >
                  Later
                </button>
                <button
                  ref={restartRef}
                  className={`admin-btn admin-btn--primary ${restartPromptIndex === 1 ? 'controller-focused' : ''}`}
                  type="button"
                  disabled={pendingAction === 'install'}
                  onFocus={() => setRestartPromptIndex(1)}
                  onClick={installDownloadedUpdate}
                >
                  {pendingAction === 'install' ? <LoaderCircle size={15} className="spin" /> : <Power size={15} />}
                  {pendingAction === 'install' ? 'Restarting...' : 'Restart now'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
