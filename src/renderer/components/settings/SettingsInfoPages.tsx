import type { ReactNode } from 'react';
import { Download, Gamepad2, Hand, HardDrive, Library, UserRound } from 'lucide-react';
import { ButtonGlyph, type GlyphName } from '../../ui/ButtonGlyph';
import { useUiPreference } from '../../ui/preferences';
import { SettingsInfoRow, SettingsStatusCard, SettingsSwitchRow } from './SettingsParts';

function GuideTile(props: { glyph?: GlyphName; icon?: ReactNode; title: string; text: string }): JSX.Element {
  return (
    <div className="settings-guide-tile" tabIndex={-1} data-settings-action>
      <span className="settings-guide-art" aria-hidden="true">
        {props.glyph ? <ButtonGlyph name={props.glyph} size={44} /> : props.icon}
      </span>
      <strong>{props.title}</strong>
      <span>{props.text}</span>
    </div>
  );
}

export function GuideSettingsPage(props: { appVersion?: string; controllerName?: string; controllerDetected: boolean }): JSX.Element {
  return (
    <>
      <h3 className="settings-section-heading">Controller basics</h3>
      <div className="settings-guide-grid">
        <GuideTile glyph="home" title="Quick menu" text="Press the PS button during a game to resume, go to Home or close the game." />
        <GuideTile glyph="cross" title="Select" text="Choose a game, open a page or change a setting." />
        <GuideTile glyph="circle" title="Back" text="Go back a step or close a menu." />
        <GuideTile icon={<Hand size={26} />} title="Ask staff" text="Need more play time, another game or help with a controller? Staff are here to help." />
      </div>
      <h3 className="settings-section-heading">About</h3>
      <div className="settings-list">
        <SettingsInfoRow
          label="NXGS Play"
          description="System software for this station"
          value={props.appVersion ? `Version ${props.appVersion}` : 'Installed'}
        />
        <SettingsInfoRow
          label="Controller"
          description={props.controllerDetected ? 'Ready for navigation and games' : 'Press the PS button on a paired controller to wake it'}
          value={props.controllerDetected ? props.controllerName ?? 'Connected' : 'Not detected'}
        />
      </div>
    </>
  );
}

export function AccessibilitySettingsPage(): JSX.Element {
  const [uiSounds, setUiSounds] = useUiPreference('uiSounds');
  const [reduceMotion, setReduceMotion] = useUiPreference('reduceMotion');
  return (
    <>
      <h3 className="settings-section-heading">Sound and motion</h3>
      <div className="settings-list">
        <SettingsSwitchRow
          label="Navigation sounds"
          description="Play soft sounds when you move, select and go back."
          checked={uiSounds}
          onToggle={() => setUiSounds(!uiSounds)}
        />
        <SettingsSwitchRow
          label="Reduce motion"
          description="Tone down animations and screen transitions."
          checked={reduceMotion}
          onToggle={() => setReduceMotion(!reduceMotion)}
        />
      </div>
      <p className="settings-capability-note">These preferences are saved on this station and also apply to the in-game quick menu.</p>
    </>
  );
}

export function UsersSettingsPage(): JSX.Element {
  return (
    <>
      <div className="settings-profile-card" tabIndex={-1} data-settings-action>
        <span className="settings-profile-avatar" aria-hidden="true"><UserRound size={40} /></span>
        <span className="settings-profile-copy">
          <small>Playing now</small>
          <strong>Guest Player</strong>
          <span>Guest profile for this station</span>
        </span>
        <span className="ps-chip ps-chip--accent">Guest</span>
      </div>
      <h3 className="settings-section-heading">Account</h3>
      <div className="settings-list">
        <SettingsInfoRow label="Sign-in" description="Account sign-in isn't available at this station." value="Not available" />
        <SettingsInfoRow label="Profiles" description="Everyone plays with the guest profile, so there is nothing to set up." value="Guest only" />
        <SettingsInfoRow label="Play time" description="Play time and payments are handled by NXGS Play at this station." value="Managed" />
      </div>
    </>
  );
}

export function StorageSettingsPage(): JSX.Element {
  return (
    <>
      <SettingsStatusCard
        tone="neutral"
        icon={<HardDrive size={30} />}
        label="Managed by staff"
        title="Station storage"
        detail="Games and their data are installed, updated and cleaned up by the NXGS team, so there is nothing to manage here."
      />
      <h3 className="settings-section-heading">On this station</h3>
      <div className="settings-list">
        <SettingsInfoRow icon={<Library size={20} />} label="Game library" description="Ask staff if a game is missing or needs an update." value="Installed by staff" />
        <SettingsInfoRow icon={<Download size={20} />} label="Downloads" description="New games and add-ons can't be downloaded from this screen." value="Staff only" />
        <SettingsInfoRow icon={<Gamepad2 size={20} />} label="Game progress" description="Each game keeps its own progress the way it normally does." value="Per game" />
      </div>
    </>
  );
}
