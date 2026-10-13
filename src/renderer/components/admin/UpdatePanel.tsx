import { useCallback, useEffect, useState } from 'react';
import { FileUp, Power, RefreshCw } from 'lucide-react';
import type { InitialData, UpdateCheckResult, UpdateDownloadProgress } from '../../../shared/types';
import { useControllerNavigation, type ControllerNavigationEvent } from '../../controllerNavigation';

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

  const pending = pendingAction !== null;
  const progressPercent = downloadProgress?.percent ?? 0;
  const downloadFailed = Boolean(
    downloadProgress && operationMessage && !operationOk && !downloadedInstallerPath && pendingAction !== 'download'
  );
  const downloadProgressLabel =
    pendingAction === 'download' ? 'Downloading update...' : downloadFailed ? 'Download failed' : 'Download complete';

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

  const handleUpdatePromptControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    if (event.type === 'back') {
      setRestartPromptOpen(false);
    } else if (event.type === 'accept') {
      if (restartPromptIndex === 0) setRestartPromptOpen(false);
      else void installDownloadedUpdate();
    } else {
      setRestartPromptIndex(event.direction === 'left' || event.direction === 'up' ? 0 : 1);
    }
  }, [installDownloadedUpdate, restartPromptIndex]);

  useControllerNavigation(restartPromptOpen && !pending, handleUpdatePromptControllerEvent);

  return (
    <section className="panel narrow-panel">
      <p className="eyebrow">Release management</p>
      <h2>Updates</h2>
      <div className="version-block">
        <span>Current app version</span>
        <strong>{props.initialData.appVersion}</strong>
      </div>
      <p className="muted">
        NXGS Play checks the release manifest for a newer packaged installer. The app stays open while the update downloads,
        then asks you to restart when the installer is ready.
      </p>
      <button
        className="primary-action wide"
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
        <RefreshCw size={19} />
        {pendingAction === 'check' ? 'Checking for updates...' : 'Check for Updates'}
      </button>
      <div className={`update-status ${pendingAction === 'check' ? 'checking' : result?.status ?? ''}`}>
        {pendingAction === 'check' ? (
          <p>Checking for updates...</p>
        ) : result ? (
          <>
            <strong>
              {result.status === 'available'
                ? 'New update available'
                : result.status === 'latest'
                  ? 'You are on the latest version'
                  : 'Update check failed'}
            </strong>
            <span>{result.message}</span>
            {result.latestVersion && <span>Latest version: {result.latestVersion}</span>}
            {result.assetName && <span>Installer asset: {result.assetName}</span>}
            {result.notes && <span>{result.notes}</span>}
            {result.releaseUrl && (
              <a href={result.releaseUrl} target="_blank" rel="noreferrer">
                View GitHub release
              </a>
            )}
            <small>Checked at {new Date(result.checkedAt).toLocaleString()}</small>
          </>
        ) : (
          <p>No update check has been run yet.</p>
        )}
      </div>
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
          <FileUp size={19} />
          {pendingAction === 'download' ? `Downloading update${progressPercent > 0 ? ` ${progressPercent}%` : '...'}` : 'Download Update'}
        </button>
      )}
      {(pendingAction === 'download' || downloadProgress) && (
        <div className={`download-progress ${downloadFailed ? 'failed' : ''}`}>
          <div>
            <span>{downloadProgressLabel}</span>
            <strong>{progressPercent}%</strong>
          </div>
          <div className="progress-track">
            <span style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      )}
      {downloadedInstallerPath && (
        <div className="update-actions">
          <button className="primary-action wide" type="button" disabled={pending} onClick={() => setRestartPromptOpen(true)}>
            <Power size={19} />
            Restart to Install Update
          </button>
        </div>
      )}
      {operationMessage && <p className={operationOk ? 'success-text' : 'error-text'}>{operationMessage}</p>}
      {restartPromptOpen && (
        <div className="modal-backdrop">
          <div className="modal update-modal">
            <p className="eyebrow">Update ready</p>
            <h2>Restart to finish update</h2>
            <p className="muted">
              Version {result?.latestVersion ?? 'the new update'} is downloaded. NXGS Play will stay open until you choose
              Restart Now.
            </p>
            <div className="update-restart-note">
              Restart Now closes NXGS Play, runs the verified installer, and reopens the app after installation.
            </div>
            <div className="dialog-actions">
              <button
                className={`secondary-action ${restartPromptIndex === 0 ? 'controller-focused' : ''}`}
                type="button"
                disabled={pendingAction === 'install'}
                onFocus={() => setRestartPromptIndex(0)}
                onClick={() => setRestartPromptOpen(false)}
              >
                Later
              </button>
              <button
                className={`primary-action ${restartPromptIndex === 1 ? 'controller-focused' : ''}`}
                type="button"
                disabled={pendingAction === 'install'}
                onFocus={() => setRestartPromptIndex(1)}
                onClick={installDownloadedUpdate}
              >
                <Power size={18} />
                {pendingAction === 'install' ? 'Restarting...' : 'Restart Now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
