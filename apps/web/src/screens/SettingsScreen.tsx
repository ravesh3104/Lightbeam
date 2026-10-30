/**
 * SettingsScreen.tsx - persisted browser preferences with explicit optical trade-offs.
 */

import { DENSITY_PROFILES, recommendedFps, type DensityProfile, type WireEncoding } from '@lightbeam/core';
import { Button, Choice, SwitchRow } from '../components/Controls';
import { Panel, Row } from '../components/Panel';
import {
  browserPlatformTag,
  clampFps,
  type ScannerEnginePreference,
  type Settings,
} from '../state/settings';

export interface SettingsScreenProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onReset: () => void;
  onBack: () => void;
}

export function SettingsScreen({ settings, onChange, onReset, onBack }: SettingsScreenProps) {
  return (
    <>
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Settings</h1>
          <p className="screen-subtitle">
            Saved in <code>localStorage</code> on this browser only — passphrases are never persisted.
          </p>
        </div>
        <Button label="Back" variant="ghost" compact onClick={onBack} />
      </div>

      <Panel title="Sending defaults">
        <div>
          <span className="field-label">Default symbol density</span>
          <Choice
            label="Default symbol density"
            options={DENSITY_PROFILES.map((entry) => ({
              value: entry.id,
              label: `${entry.label} (${17 + 4 * entry.version}x${17 + 4 * entry.version})`,
            }))}
            value={settings.profile}
            onChange={(value) => {
              const profile = value as DensityProfile['id'];
              onChange({ profile, fps: clampFps(recommendedFps(browserPlatformTag(), profile)) });
            }}
          />
          <p className="caption">
            Larger modules (Phone) survive distance and handheld shake; denser symbols (Laptop/Tablet) carry more bytes
            per frame on a desktop monitor scanned by a steady phone.
          </p>
        </div>

        <div>
          <span className="field-label">Default frame rate</span>
          <Choice
            label="Default frame rate"
            options={[10, 13, 15, 20, 24].map((value) => ({ value: String(value), label: `${value} fps` }))}
            value={String(settings.fps)}
            onChange={(value) => onChange({ fps: clampFps(Number(value)) })}
          />
          <p className="caption">
            10–13 fps suits older mobile browsers; 15 fps is the universal sweet spot; 20–24 fps works well from a high
            refresh desktop monitor to a modern camera.
          </p>
        </div>

        <div>
          <span className="field-label">Default wire encoding</span>
          <Choice
            label="Default wire encoding"
            options={[
              { value: 'base32', label: 'Base32 (Universal)' },
              { value: 'raw', label: 'Raw bytes (jsQR only)' },
            ]}
            value={settings.wireEncoding}
            onChange={(value) => onChange({ wireEncoding: value as WireEncoding })}
          />
        </div>

        <SwitchRow
          label="Encrypt by default"
          hint="Pre-enables passphrase encryption on the Send screen without ever storing a passphrase."
          value={settings.encryptByDefault}
          onValueChange={(value) => onChange({ encryptByDefault: value })}
        />
      </Panel>

      <Panel title="Browser display & camera pipeline">
        <SwitchRow
          label="Keep screen awake during transfers"
          hint="Requests the browser Screen Wake Lock API so neither device dims mid-stream."
          value={settings.keepAwake}
          onValueChange={(value) => onChange({ keepAwake: value })}
        />

        <SwitchRow
          label="Start sending in Cinema dark stage"
          hint="Surrounds the white QR quiet zone with pure #000000 to help camera auto-exposure."
          value={settings.cinemaStage}
          onValueChange={(value) => onChange({ cinemaStage: value })}
        />

        <SwitchRow
          label="Vibrate when transfer completes"
          hint="Triggers a short pulse via navigator.vibrate on mobile browsers that support it."
          value={settings.vibrateOnComplete}
          onValueChange={(value) => onChange({ vibrateOnComplete: value })}
        />

        <div>
          <span className="field-label">Camera QR decoder engine</span>
          <Choice
            label="Camera QR decoder engine"
            options={[
              {
                value: 'auto',
                label: 'Auto (BarcodeDetector + jsQR fallback)',
              },
              {
                value: 'jsqr',
                label: 'Force jsQR (supports Raw byte mode)',
              },
            ]}
            value={settings.scannerEngine}
            onChange={(value) => onChange({ scannerEngine: value as ScannerEnginePreference })}
          />
          <p className="caption">
            Auto uses the browser&apos;s hardware-accelerated <code>BarcodeDetector</code> when available and falls back
            to pure-JS <code>jsQR</code>. Choose <code>jsQR</code> when receiving a Raw byte-mode stream.
          </p>
        </div>
      </Panel>

      <Row>
        <Button label="Reset preferences to defaults" variant="secondary" onClick={onReset} />
      </Row>
    </>
  );
}
