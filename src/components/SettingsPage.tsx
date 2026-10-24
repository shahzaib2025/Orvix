import CompanionMemories from './CompanionMemories';
import FastWorkSettings from './FastWorkSettings';
import StartupSettings from './StartupSettings';
import DesktopBarSettings from './DesktopBarSettings';
import './settings-page.css';

type Project = { id: string; name: string };
type SettingsPageProps = {
  projects: Project[];
  reduceMotion: boolean;
  setReduceMotion: (value: boolean) => void;
};

export default function SettingsPage({ projects, reduceMotion, setReduceMotion }: SettingsPageProps) {
  return <div className="settings-page">
    <header className="settings-page-header">
      <h1>Settings</h1>
      <p>Manage how Orvix looks and works on this device.</p>
    </header>

    <section id="settings-appearance" className="settings-section" aria-labelledby="settings-appearance-title">
      <div className="settings-section-heading">
        <h2 id="settings-appearance-title">Appearance</h2>
        <p>Adjust the interface to suit you.</p>
      </div>
      <div className="settings-rows">
        <div className="settings-row">
          <div className="settings-row-copy">
            <strong>Reduce motion</strong>
            <p>Use simpler transitions throughout Orvix.</p>
          </div>
          <button type="button" role="switch" aria-checked={reduceMotion} aria-label="Reduce motion"
            className={`toggle${reduceMotion ? ' on' : ''}`} onClick={() => setReduceMotion(!reduceMotion)}><span /></button>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy">
            <strong>Local storage</strong>
            <p>Conversations and projects are saved on this device.</p>
          </div>
          <span className="settings-value">On this device</span>
        </div>
      </div>
    </section>

    <DesktopBarSettings />

    <div className="settings-section settings-memory-section">
      <CompanionMemories projects={projects} />
    </div>

    <section id="settings-windows" className="settings-section" aria-labelledby="settings-windows-title">
      <div className="settings-section-heading">
        <h2 id="settings-windows-title">Windows startup</h2>
        <p>Choose whether Orvix opens when you sign in.</p>
      </div>
      <StartupSettings />
    </section>

    <section id="settings-fast" className="settings-section settings-fast-section" aria-label="Fast profile settings">
      <FastWorkSettings />
    </section>
  </div>;
}
