/**
 * AboutScreen.tsx - protocol architecture, measured constants, and live web capabilities.
 */

import { DENSITY_PROFILES, LIMITS, VERSION, formatBytes } from '@lightbeam/core';
import { Button } from '../components/Controls';
import { KeyValue, Panel } from '../components/Panel';
import { isWakeLockSupported } from '../services/display';
import { canWebShareFiles } from '../services/inbox';
import { hasNativeBarcodeDetector, isCameraAvailable, isSecureContextOk } from '../services/scanner';

export interface AboutScreenProps {
  onBack: () => void;
}

export function AboutScreen({ onBack }: AboutScreenProps) {
  const hasSw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const hasIdb = typeof indexedDB !== 'undefined' && indexedDB !== null;

  return (
    <>
      <div className="screen-header">
        <div>
          <h1 className="screen-title">About LightBeam {VERSION}</h1>
          <p className="screen-subtitle">
            Web-first optical file transfer — fountain-coded QR streams over screen and camera.
          </p>
        </div>
        <Button label="Back" variant="ghost" compact onClick={onBack} />
      </div>

      <Panel title="The optical channel">
        <p>
          The sender renders one QR symbol per animation slot; the receiver&apos;s browser camera decodes them. Unlike
          TCP or WebRTC, an optical link is unidirectional and drops whole frames whenever a hand shifts, autofocus
          hunts, or a camera shutter spans a frame transition.
        </p>
        <p>
          Because there is no return channel, the payload is encoded with a rateless fountain code rather than a
          numbered sequence. Every frame is self-describing and order-independent: the receiver collects any subset of
          slightly more than <code>K</code> frames to reconstruct the exact file.
        </p>
      </Panel>

      <Panel title="Core algorithms">
        <h3 className="subheading">Luby Transform fountain code &amp; Robust Soliton (c = 0.03, δ = 0.5)</h3>
        <p>
          Each data frame XORs a deterministic pseudo-random subset of source blocks derived from its 32-bit seed,
          block count, and session id. Robust soliton degree sampling achieves ~1.10x overhead on clean links (compared
          with 2.06x for textbook ideal soliton at <code>K = 1024</code>), backed by bounded GF(2) Gaussian elimination
          if belief-propagation peeling stalls near completion.
        </p>

        <h3 className="subheading">Systematic prefix (0.10K)</h3>
        <p>
          The first 10% of data slots transmit uncoded single blocks so receivers see immediate progress while staying
          resilient under 30%–50% burst frame loss. Manifest fragments repeat every 24 slots so a receiver joining at
          any moment locks onto the session within ~1 second.
        </p>

        <h3 className="subheading">ISO/IEC 18004 QR &amp; Base32 wire framing</h3>
        <p>
          Frames start with a 13-byte header (<code>0x4C</code> magic, version + flags, type, 32-bit session id,
          seed/fragment word, and CRC-16/CCITT). By default the entire frame is encoded in unpadded RFC 4648 Base32 so
          it packs into QR alphanumeric mode (8.80 bits/byte, +10%) and survives browser{' '}
          <code>BarcodeDetector.rawValue</code> string boundaries intact.
        </p>

        <h3 className="subheading">Authenticated encryption &amp; integrity</h3>
        <p>
          Every manifest carries the original payload&apos;s SHA-256 digest; unverified bytes are never offered or
          stored. Optional encryption uses XChaCha20-Poly1305 with keys derived via <code>scrypt</code> (
          <code>N = 2^15, r = 8, p = 1</code>) and authenticated manifest associated data.
        </p>
      </Panel>

      <div className="grid-two">
        <Panel title="Measured limits & benchmarks">
          <KeyValue label="Max file payload" value={formatBytes(LIMITS.maxPayloadBytes)} />
          <KeyValue label="Max pasted text" value={formatBytes(LIMITS.maxTextBytes)} />
          <KeyValue label="Max blocks per session" value={`${LIMITS.maxBlocks}`} />
          <KeyValue label="Typical optical goodput" value="60–150 kB/s" />
          <KeyValue label="Fountain overhead" value="~1.10x clean · ~1.62x at 30% loss" />
          <KeyValue label="Recommended distance" value="15–35 cm, screen to camera" />
        </Panel>

        <Panel title="This browser's capabilities">
          <KeyValue label="Secure context (HTTPS / localhost)" value={isSecureContextOk() ? 'Yes' : 'No'} />
          <KeyValue label="Camera API (getUserMedia)" value={isCameraAvailable() ? 'Available' : 'Unavailable'} />
          <KeyValue
            label="Hardware BarcodeDetector"
            value={hasNativeBarcodeDetector() ? 'Supported' : 'Fallback to jsQR'}
          />
          <KeyValue label="Screen Wake Lock API" value={isWakeLockSupported() ? 'Supported' : 'Unavailable'} />
          <KeyValue label="IndexedDB local inbox" value={hasIdb ? 'Supported' : 'In-memory fallback'} />
          <KeyValue label="PWA Service Worker" value={hasSw ? 'Supported' : 'Unavailable'} />
          <KeyValue label="Web Share API (files)" value={canWebShareFiles() ? 'Supported' : 'Download mode'} />
        </Panel>
      </div>

      <Panel title="Symbol density profiles">
        {DENSITY_PROFILES.map((profile) => {
          const modules = 17 + 4 * profile.version;
          return (
            <KeyValue
              key={profile.id}
              label={profile.label}
              value={`${modules}x${modules} modules · QR v${profile.version} · EC ${profile.ecLevel}`}
            />
          );
        })}
      </Panel>
    </>
  );
}
