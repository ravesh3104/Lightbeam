/**
 * HomeScreen.tsx - the two-button front door and live instance overview.
 */

import { useEffect, useState } from 'react';
import { LIMITS, VERSION, formatBytes } from '@lightbeam/core';
import { Button } from '../components/Controls';
import { LoopbackBench } from '../components/LoopbackBench';
import { KeyValue, Panel, Row } from '../components/Panel';
import { fetchServerOverview, type ServerHealth, type ServerStats } from '../services/telemetry';

export interface HomeScreenProps {
  inboxCount: number;
  onSend: () => void;
  onReceive: () => void;
  onFiles: () => void;
  onSettings: () => void;
  onAbout: () => void;
  onInboxChanged: () => void;
}

export function HomeScreen({
  inboxCount,
  onSend,
  onReceive,
  onFiles,
  onSettings,
  onAbout,
  onInboxChanged,
}: HomeScreenProps) {
  const [health, setHealth] = useState<ServerHealth | null>(null);
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [probed, setProbed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchServerOverview().then((res) => {
      if (cancelled) return;
      setHealth(res.health);
      setStats(res.stats);
      setProbed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [inboxCount]);

  return (
    <>
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Send a file through the air, screen to camera</h1>
          <p className="screen-subtitle">
            Fountain-coded animated QR streams. No account, no pairing, no cloud upload, and no return channel.
          </p>
        </div>
        <div className="row">
          {health?.storesFileContent === false ? (
            <span className="badge badge-ok">Zero file bytes on server</span>
          ) : (
            <span className="badge badge-accent">100% client-side optical engine</span>
          )}
        </div>
      </div>

      <div className="grid-two">
        <Button
          label="Send"
          hero
          onClick={onSend}
          hint="Drop a file or paste text — this browser window becomes the animated QR transmitter."
        />
        <Button
          label="Receive"
          variant="secondary"
          hero
          onClick={onReceive}
          hint="Open the camera in any browser and point it at the sending screen."
        />
      </div>

      <LoopbackBench onInboxChanged={onInboxChanged} onOpenInbox={onFiles} />

      <div className="grid-two">
        <Panel title="How it works">
          <p>
            The payload is compressed with deflate when that saves more than 5%, optionally encrypted with
            XChaCha20-Poly1305, split into equal blocks, and encoded into an endless Luby Transform fountain stream of
            QR symbols.
          </p>
          <p className="caption">
            The receiving browser reads symbols in any order via hardware <code>BarcodeDetector</code> or{' '}
            <code>jsQR</code>, peels blocks as equations resolve, verifies SHA-256 over the reconstructed bytes, and
            only then offers the file for download or saves it to your browser inbox.
          </p>
        </Panel>

        <Panel title="Honest expectations">
          <p>
            Expect <strong>60–150 kB/s</strong> over a clean screen-to-camera link. A 100 kB document finishes in 1–2
            seconds; a 1 MB image takes 10–20 seconds; multi-megabyte archives take minutes and need both screens kept
            awake and steady.
          </p>
          <p className="caption">
            Limits: files up to {formatBytes(LIMITS.maxPayloadBytes)}, text up to {formatBytes(LIMITS.maxTextBytes)}.
            Without a passphrase the stream is legible to any camera pointed at your display — enable encryption in
            shared spaces.
          </p>
        </Panel>
      </div>

      <Panel title="Instance telemetry">
        {!probed ? (
          <p className="muted">Checking unified server telemetry...</p>
        ) : stats ? (
          <>
            <KeyValue label="Verified transfers" value={`${stats.completed} of ${stats.total} sessions`} />
            <KeyValue label="Bytes moved over light" value={formatBytes(stats.bytesSent)} />
            <KeyValue
              label="Median fountain overhead"
              value={stats.medianOverhead !== null ? `${stats.medianOverhead.toFixed(2)}x` : '—'}
            />
            <KeyValue
              label="Median duration"
              value={stats.medianSeconds !== null ? `${Math.round(stats.medianSeconds)}s` : '—'}
            />
            <p className="caption">
              Server stores session codes and anonymous timing summaries only (<code>storesFileContent: false</code>).
            </p>
          </>
        ) : (
          <p className="muted">
            Running standalone / offline — sending and receiving work identically because file bytes travel directly
            from screen to camera.
          </p>
        )}
      </Panel>

      <Row stretch>
        <Button
          label={inboxCount > 0 ? `Received files (${inboxCount})` : 'Received files'}
          variant="ghost"
          onClick={onFiles}
        />
        <Button label="Settings" variant="ghost" onClick={onSettings} />
        <Button label={`About LightBeam ${VERSION}`} variant="ghost" onClick={onAbout} />
      </Row>
    </>
  );
}
