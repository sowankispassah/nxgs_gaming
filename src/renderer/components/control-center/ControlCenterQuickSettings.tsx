import type { CSSProperties } from 'react';
import { Info, LoaderCircle, Settings, Sun, Volume2, VolumeX } from 'lucide-react';
import type { AudioStatus, DisplayStatus } from '../../../shared/types';
import { cx } from './cx';

export function ControlCenterQuickSettings(props: {
  selected: 'audio' | 'brightness' | null;
  audio: AudioStatus;
  volume: number;
  audioPending: 'volume' | 'mute' | null;
  audioMessage: string;
  display: DisplayStatus;
  brightness: number;
  brightnessMessage: string;
  onRequestClose: () => void;
  onSelectAudio: () => void;
  onSelectBrightness: () => void;
  onToggleMute: () => void;
  onVolumeInput: (value: number) => void;
  onBrightnessInput: (value: number) => void;
}): JSX.Element {
  const { audio, display } = props;
  const brightnessSupported = display.brightness.supported;

  return (
    <section
      className="quick-settings-panel"
      id="quick-settings-panel"
      aria-label="Quick Settings"
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        if (next === null) return;
        if (next instanceof Node && event.currentTarget.parentElement?.contains(next)) return;
        props.onRequestClose();
      }}
    >
      <header className="quick-settings-title">
        <Settings size={18} aria-hidden="true" />
        <strong>Quick Settings</strong>
      </header>

      <div
        className={cx(
          'quick-settings-control',
          'quick-settings-audio',
          props.selected === 'audio' && 'selected',
          audio.muted && 'muted',
          !audio.supported && 'unavailable'
        )}
        onMouseEnter={props.onSelectAudio}
      >
        <header>
          <button
            type="button"
            className={audio.muted ? 'muted' : ''}
            disabled={props.audioPending !== null || !audio.supported}
            aria-label={props.audioPending === 'mute' ? 'Updating mute status' : audio.muted ? 'Unmute audio' : 'Mute audio'}
            onClick={props.onToggleMute}
          >
            {props.audioPending === 'mute'
              ? <LoaderCircle size={18} className="spin" />
              : audio.muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
          <strong>Audio</strong>
          <b>{!audio.supported ? 'Unavailable' : audio.muted ? 'Muted' : `${props.volume}%`}</b>
        </header>
        <div className="quick-settings-range" style={{ '--quick-range-value': `${props.volume}%` } as CSSProperties}>
          <span className="quick-settings-range-track" aria-hidden="true">
            <span className="quick-settings-range-fill" />
          </span>
          <input
            id="quick-settings-audio"
            type="range"
            min="0"
            max="100"
            step="1"
            value={props.volume}
            aria-label="Quick audio volume"
            aria-valuetext={audio.muted ? `Muted at ${props.volume} percent` : `${props.volume} percent`}
            disabled={props.audioPending === 'mute' || !audio.supported}
            onFocus={props.onSelectAudio}
            onInput={(event) => props.onVolumeInput(Number(event.currentTarget.value))}
          />
        </div>
        {!audio.supported && (
          <small role="status">
            <Info size={15} aria-hidden="true" />
            <span>{props.audioMessage || audio.message || 'Audio control is unavailable.'}</span>
          </small>
        )}
      </div>

      <div
        className={cx(
          'quick-settings-control',
          'quick-settings-brightness',
          props.selected === 'brightness' && 'selected',
          !brightnessSupported && 'unavailable'
        )}
        onMouseEnter={props.onSelectBrightness}
      >
        <header>
          <span aria-hidden="true"><Sun size={20} /></span>
          <strong>Brightness</strong>
          <b>{brightnessSupported ? `${props.brightness}%` : 'Unavailable'}</b>
        </header>
        <div className="quick-settings-range" style={{ '--quick-range-value': `${props.brightness}%` } as CSSProperties}>
          <span className="quick-settings-range-track" aria-hidden="true">
            <span className="quick-settings-range-fill" />
          </span>
          <input
            id="quick-settings-brightness"
            type="range"
            min="0"
            max="100"
            step="1"
            value={props.brightness}
            aria-label="Quick display brightness"
            aria-valuetext={brightnessSupported ? `${props.brightness} percent` : 'Brightness unavailable'}
            disabled={!brightnessSupported}
            onFocus={props.onSelectBrightness}
            onInput={(event) => props.onBrightnessInput(Number(event.currentTarget.value))}
          />
        </div>
        {!brightnessSupported && (
          <small role="status">
            <Info size={15} aria-hidden="true" />
            <span>{props.brightnessMessage || display.brightness.message || 'Brightness control is unavailable for this display.'}</span>
          </small>
        )}
      </div>
    </section>
  );
}
