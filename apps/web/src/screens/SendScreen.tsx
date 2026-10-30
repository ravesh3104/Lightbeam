/**
 * SendScreen.tsx - browser transmitter with self-correcting frame scheduler.
 *
 * Schedules frames from the ideal timestamp of the previous slot rather than
 * `now`: if a tab stalls or drops behind by >3 intervals, it resynchronises
 * cleanly rather than emitting an unreadable catch-up burst.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  DENSITY_PROFILES,
  LIMITS,
  TransferSender,
  formatBytes,
  fromBase64Url,
  passphraseFingerprint,
  planSession,
  planWarnings,
  prepareTransfer,
  recommendedFps,
  type DensityProfile,
  type EncodedSymbol,
  type PreparedTransfer,
  type WireEncoding,
} from '@lightbeam/core';
import { Button, Choice, SwitchRow } from '../components/Controls';
import { KeyValue, Panel, ProgressBar, Row } from '../components/Panel';
import { QrView } from '../components/QrView';
import { formatDuration, toggleFullscreen, useScreenWakeLock } from '../services/display';
import { FileError, readBrowserFile, textPayload, type PickedWebFile } from '../services/inbox';
import { registerSession } from '../services/telemetry';
import { browserPlatformTag, clampFps, type Settings } from '../state/settings';

type Phase = 'setup' | 'preparing' | 'sending';

export interface SendScreenProps {
  settings: Settings;
  initialProfile?: DensityProfile['id'] | null;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onTransferActiveChange: (active: boolean) => void;
  onBack: () => void;
}

export function SendScreen({
  settings,
  initialProfile,
  onSettingsChange,
  onTransferActiveChange,
  onBack,
}: SendScreenProps) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [picked, setPicked] = useState<PickedWebFile | null>(null);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const [profile, setProfile] = useState<DensityProfile['id']>(initialProfile ?? settings.profile);
  const [fps, setFps] = useState<number>(
    clampFps(settings.fps || recommendedFps(browserPlatformTag(), initialProfile ?? settings.profile)),
  );
  const [wireEncoding, setWireEncoding] = useState<WireEncoding>(settings.wireEncoding);
  const [encrypt, setEncrypt] = useState<boolean>(settings.encryptByDefault);
  const [passphrase, setPassphrase] = useState('');

  const [prepared, setPrepared] = useState<PreparedTransfer | null>(null);
  const [symbol, setSymbol] = useState<EncodedSymbol | null>(null);
  const [paused, setPaused] = useState(false);
  const [cinema, setCinema] = useState(settings.cinemaStage);
  const [stats, setStats] = useState({ frames: 0, measuredFps: 0, behind: false });
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 800,
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const senderRef = useRef<TransferSender | null>(null);
  const slotRef = useRef(0);
  const nextFrameAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(false);
  const frameStatsRef = useRef({ frames: 0, windowStart: 0, windowFrames: 0, behind: false });

  const wakeLock = useScreenWakeLock(phase === 'sending', settings.keepAwake);

  useEffect(() => {
    onTransferActiveChange(phase === 'sending');
    return () => onTransferActiveChange(false);
  }, [phase, onTransferActiveChange]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const qrSize = useMemo(() => {
    const maxTarget = cinema ? 520 : 400;
    return Math.max(220, Math.min(viewportWidth - 64, maxTarget));
  }, [viewportWidth, cinema]);

  const payloadBytes = useMemo(() => {
    if (picked) return picked.bytes.byteLength;
    if (text.trim().length > 0) return new TextEncoder().encode(text).byteLength;
    return 0;
  }, [picked, text]);

  const estimate = useMemo(() => {
    if (payloadBytes === 0) return null;
    try {
      const plan = planSession(payloadBytes, profile, { wireEncoding });
      return {
        plan,
        modules: plan.modules,
        blocks: plan.k,
        blockSize: plan.blockSize,
        seconds: plan.estimatedSeconds(fps),
        bytesPerSecond: plan.bytesPerFrame * fps,
        warnings: planWarnings(plan, payloadBytes, fps),
      };
    } catch (error) {
      return {
        plan: null,
        modules: 0,
        blocks: 0,
        blockSize: 0,
        seconds: 0,
        bytesPerSecond: 0,
        warnings: [(error as Error).message],
      };
    }
  }, [payloadBytes, profile, wireEncoding, fps]);

  const stopLoop = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    const sender = senderRef.current;
    if (!sender) return;

    const interval = 1000 / fps;
    if (!pausedRef.current) {
      const now = performance.now();
      if (nextFrameAtRef.current === 0 || now - nextFrameAtRef.current > interval * 3) {
        nextFrameAtRef.current = now;
        if (frameStatsRef.current.frames > 3) {
          frameStatsRef.current.behind = true;
        }
      }

      const slot = slotRef.current;
      const startedAt = performance.now();
      const next = sender.symbolAt(slot);
      setSymbol(next);
      sender.markShown(slot);
      slotRef.current = slot + 1;

      const drawMs = performance.now() - startedAt;
      if (drawMs > interval) frameStatsRef.current.behind = true;

      const fs = frameStatsRef.current;
      fs.frames++;
      fs.windowFrames++;
      if (fs.windowStart === 0) fs.windowStart = now;
      if (now - fs.windowStart >= 950) {
        const measuredFps = (fs.windowFrames * 1000) / (now - fs.windowStart);
        setStats({ frames: fs.frames, measuredFps, behind: fs.behind });
        fs.windowStart = now;
        fs.windowFrames = 0;
      }
    }

    nextFrameAtRef.current += interval;
    const delay = Math.max(0, nextFrameAtRef.current - performance.now());
    timerRef.current = setTimeout(tick, delay);
  }, [fps]);

  useEffect(() => {
    if (phase !== 'sending') return;
    stopLoop();
    nextFrameAtRef.current = 0;
    timerRef.current = setTimeout(tick, 0);
    return stopLoop;
  }, [phase, tick, stopLoop]);

  const handleFileObject = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setProblem(null);
      try {
        const loaded = await readBrowserFile(file);
        setPicked(loaded);
        setText('');
        if (!name.trim()) setName(loaded.name);
      } catch (error) {
        setProblem(error instanceof FileError ? error.message : (error as Error).message);
      }
    },
    [name],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setDragOver(false);
      const file = event.dataTransfer?.files?.[0];
      void handleFileObject(file);
    },
    [handleFileObject],
  );

  const start = useCallback(async () => {
    setProblem(null);
    setNotice(null);
    setPhase('preparing');

    try {
      let data: Uint8Array;
      let fileName: string;
      let mime: string;

      if (picked) {
        data = picked.bytes;
        fileName = name.trim() || picked.name;
        mime = picked.mime;
      } else {
        const payload = textPayload(text);
        data = payload.bytes;
        fileName = name.trim() || payload.name;
        mime = payload.mime;
      }

      if (encrypt && passphrase.trim().length === 0) {
        throw new FileError('Enter a passphrase, or disable encryption before starting.');
      }

      const result = await prepareTransfer({
        data,
        name: fileName,
        mime,
        profile,
        wireEncoding,
        passphrase: encrypt ? passphrase : undefined,
        note: wireEncoding === 'raw' ? 'raw byte mode (jsQR browser receivers)' : undefined,
      });

      if (encrypt) {
        const salt = result.manifest.salt ? fromBase64Url(result.manifest.salt) : new Uint8Array(16);
        setFingerprint(passphraseFingerprint(passphrase, salt, result.manifest.kdf ?? undefined));
      } else {
        setFingerprint(null);
      }

      const firstSymbol = new TransferSender(result).symbolAt(0);
      senderRef.current = new TransferSender(result);
      slotRef.current = 0;
      nextFrameAtRef.current = 0;
      frameStatsRef.current = { frames: 0, windowStart: 0, windowFrames: 0, behind: false };
      pausedRef.current = false;
      setPaused(false);
      setCinema(settings.cinemaStage);
      setStats({ frames: 0, measuredFps: 0, behind: false });
      setPrepared(result);
      setSymbol(firstSymbol);
      setPhase('sending');

      onSettingsChange({ profile, fps, wireEncoding });

      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', `/send?code=${result.code}`);
      }

      void registerSession({
        sessionId: result.sessionId,
        code: result.code,
        name: result.manifest.name,
        mime: result.manifest.mime,
        bytes: result.originalPayload.length,
        wireBytes: result.wirePayload.length,
        blockSize: result.manifest.bs,
        blocks: result.manifest.k,
        profile: result.plan.profile.id,
        encrypted: result.encryption !== 'none',
        codec: result.manifest.codec,
        platform: browserPlatformTag(),
      });
    } catch (error) {
      setPhase('setup');
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, [picked, name, text, encrypt, passphrase, profile, wireEncoding, fps, settings.cinemaStage, onSettingsChange]);

  const stop = useCallback(() => {
    stopLoop();
    senderRef.current = null;
    setSymbol(null);
    setPrepared(null);
    setNotice(null);
    setCinema(false);
    setPhase('setup');
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/send');
    }
  }, [stopLoop]);

  const restartPrefix = useCallback(() => {
    senderRef.current?.restartSystematic();
    setNotice(
      'Systematic prefix restarted: the next frames emit uncoded source blocks for a receiver that just joined.',
    );
  }, []);

  const copyShareLink = useCallback(async () => {
    if (!prepared || typeof window === 'undefined') return;
    const shareUrl = `${window.location.origin}/receive?code=${prepared.code}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      setNotice(`Share this receiver URL: ${shareUrl}`);
    }
  }, [prepared]);

  if (phase === 'sending' && prepared && symbol) {
    const plan = prepared.plan;
    const savedBytes = prepared.originalPayload.length - prepared.wirePayload.length;

    return (
      <>
        <div className="screen-header">
          <div>
            <h1 className="screen-title">Sending {prepared.manifest.name}</h1>
            <p className="screen-subtitle">
              Keep this tab visible and bright — point the receiving browser camera at the QR symbol below.
            </p>
          </div>
          <Row>
            <Button
              label={cinema ? 'Exit cinema stage' : 'Cinema dark stage'}
              variant="ghost"
              compact
              onClick={() => {
                const next = !cinema;
                setCinema(next);
                void toggleFullscreen(next ? stageRef.current : null);
              }}
            />
            <Button label="Stop" variant="danger" compact onClick={stop} />
          </Row>
        </div>

        <div ref={stageRef} className={`qr-stage ${cinema ? 'cinema' : ''}`.trim()}>
          <QrView symbol={symbol} size={qrSize} />
          <div className="session-code" data-testid="session-code">
            {prepared.code}
          </div>
          <div className="caption">Session code — the receiver displays the exact same 7 characters</div>
          {fingerprint ? <div className="fingerprint-badge">Key fingerprint: {fingerprint}</div> : null}
          {cinema ? (
            <Row>
              <Button
                label={paused ? 'Resume' : 'Pause'}
                variant="secondary"
                compact
                onClick={() => {
                  pausedRef.current = !pausedRef.current;
                  setPaused(pausedRef.current);
                }}
              />
              <Button label="Exit cinema" variant="ghost" compact onClick={() => setCinema(false)} />
              <Button label="Stop" variant="danger" compact onClick={stop} />
            </Row>
          ) : null}
        </div>

        <Panel>
          <KeyValue
            label="Payload"
            value={
              `${formatBytes(prepared.originalPayload.length)} (${formatBytes(prepared.wirePayload.length)} on wire` +
              (savedBytes > 0 ? `, deflate saved ${formatBytes(savedBytes)}` : '') +
              ')'
            }
          />
          <KeyValue
            label="Session geometry"
            value={`${plan.k} blocks of ${plan.blockSize} B · ${plan.modules}x${plan.modules} modules · ${plan.wireEncoding}`}
          />
          <KeyValue label="Frames shown" value={`${stats.frames}`} />
          <KeyValue label="Measured rate" value={`${stats.measuredFps.toFixed(1)} fps (target ${fps} fps)`} />
          <KeyValue
            label="Screen Wake Lock"
            value={wakeLock.held ? 'Active (screen kept awake)' : wakeLock.supported ? 'Pending' : 'Not supported by browser'}
          />

          {stats.behind ? (
            <p className="caption text-warn">
              This browser tab is struggling to hold {fps} fps. Lower the frame rate or switch to a smaller symbol
              profile.
            </p>
          ) : null}

          <ProgressBar
            progress={Math.min(1, stats.frames / Math.max(1, senderRef.current?.expectedFrames ?? 1))}
            label="First fountain pass progress"
          />
          <p className="caption">
            Progress marks one expected pass (~{senderRef.current?.expectedFrames ?? 0} frames). Because there is no
            return channel, the transmitter keeps streaming fountain frames until you stop it so late-joining receivers
            still finish.
          </p>
        </Panel>

        {notice ? (
          <Panel tone="warn">
            <p className="caption text-warn">{notice}</p>
          </Panel>
        ) : null}

        <Row stretch>
          <Button
            label={paused ? 'Resume stream' : 'Pause stream'}
            variant="secondary"
            onClick={() => {
              pausedRef.current = !pausedRef.current;
              setPaused(pausedRef.current);
            }}
          />
          <Button label="Restart systematic prefix" variant="secondary" onClick={restartPrefix} />
          <Button
            label={copiedLink ? 'Copied receive link!' : 'Copy receive link'}
            variant="ghost"
            onClick={() => void copyShareLink()}
          />
          <Button label="Stop sending" variant="danger" onClick={stop} />
        </Row>
      </>
    );
  }

  const canStart = payloadBytes > 0 && Boolean(estimate?.plan);

  return (
    <>
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Send</h1>
          <p className="screen-subtitle">Choose a file or paste text to turn this browser window into an optical transmitter.</p>
        </div>
        <Button label="Back" variant="ghost" compact onClick={onBack} />
      </div>

      <Panel title="1. What to send">
        <label
          htmlFor="send-file-input"
          className={`dropzone ${dragOver ? 'over' : ''}`.trim()}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <input
            ref={fileInputRef}
            id="send-file-input"
            type="file"
            className="sr-only"
            onChange={(e) => void handleFileObject(e.target.files?.[0])}
          />
          <strong>
            {picked
              ? `${picked.name} (${formatBytes(picked.bytes.byteLength)})`
              : 'Drop any file here, or click to browse'}
          </strong>
          <span className="caption">
            Up to {formatBytes(LIMITS.maxPayloadBytes)} · compressed and hashed locally in your browser
          </span>
        </label>

        {picked ? (
          <Row>
            <Button
              label="Choose a different file"
              variant="secondary"
              compact
              onClick={() => fileInputRef.current?.click()}
            />
            <Button
              label="Clear file"
              variant="ghost"
              compact
              onClick={() => {
                setPicked(null);
                setName('');
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            />
          </Row>
        ) : (
          <div>
            <label className="field-label" htmlFor="send-text-input">
              Or paste text / snippet to transmit
            </label>
            <textarea
              id="send-text-input"
              className="text-area"
              placeholder="Paste a URL, SSH key, config snippet, or note..."
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setPicked(null);
              }}
              spellCheck={false}
            />
            <p className="caption">Text limit {formatBytes(LIMITS.maxTextBytes)}.</p>
          </div>
        )}

        <div>
          <label className="field-label" htmlFor="send-name-input">
            Filename shown to receiver
          </label>
          <input
            id="send-name-input"
            type="text"
            className="text-input"
            placeholder="document.pdf"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {payloadBytes > 0 && estimate?.plan ? (
          <p className="caption" data-testid="send-estimate">
            {formatBytes(payloadBytes)} · {estimate.modules}x{estimate.modules} modules · ~{estimate.blocks} blocks of{' '}
            {estimate.blockSize} B · ~{formatDuration(estimate.seconds)} at {fps} fps (
            {formatBytes(Math.round(estimate.bytesPerSecond))}/s, pre-compression estimate)
          </p>
        ) : null}

        {estimate?.warnings.map((warning) => (
          <p key={warning} className="caption text-warn">
            {warning}
          </p>
        ))}
      </Panel>

      <Panel title="2. Symbol geometry & wire speed">
        <div>
          <span className="field-label">Symbol density</span>
          <Choice
            label="Symbol density"
            options={DENSITY_PROFILES.map((entry) => ({
              value: entry.id,
              label: `${entry.label} (${17 + 4 * entry.version}x${17 + 4 * entry.version})`,
              hint: entry.description,
            }))}
            value={profile}
            onChange={(val) => {
              const id = val as DensityProfile['id'];
              setProfile(id);
              const rec = clampFps(recommendedFps(browserPlatformTag(), id));
              setFps(rec);
              onSettingsChange({ profile: id, fps: rec });
            }}
          />
        </div>

        <div>
          <span className="field-label">Frames per second</span>
          <Choice
            label="Frames per second"
            options={[10, 13, 15, 20, 24].map((val) => ({ value: String(val), label: `${val} fps` }))}
            value={String(fps)}
            onChange={(val) => {
              const nextFps = clampFps(Number(val));
              setFps(nextFps);
              onSettingsChange({ fps: nextFps });
            }}
          />
          <p className="caption">
            15 fps holds each symbol for 66 ms so rolling-shutter cameras capture clean, unblended frames.
          </p>
        </div>

        <div>
          <span className="field-label">Wire encoding</span>
          <Choice
            label="Wire encoding"
            options={[
              {
                value: 'base32',
                label: 'Base32 (Universal default)',
                hint: 'Works with every browser BarcodeDetector and jsQR.',
              },
              {
                value: 'raw',
                label: 'Raw bytes (+10% faster, jsQR only)',
                hint: 'Use when receiving in LightBeam Web with jsQR mode.',
              },
            ]}
            value={wireEncoding}
            onChange={(val) => {
              const mode = val as WireEncoding;
              setWireEncoding(mode);
              onSettingsChange({ wireEncoding: mode });
            }}
          />
        </div>
      </Panel>

      <Panel title="3. Privacy & authenticated encryption">
        <SwitchRow
          label="Encrypt with a passphrase"
          hint="XChaCha20-Poly1305 + scrypt key derivation. Passphrases never travel in the QR stream."
          value={encrypt}
          onValueChange={(next) => {
            setEncrypt(next);
            onSettingsChange({ encryptByDefault: next });
          }}
        />
        {encrypt ? (
          <div>
            <label className="field-label" htmlFor="send-passphrase-input">
              Shared passphrase
            </label>
            <input
              id="send-passphrase-input"
              type="password"
              className="text-input"
              placeholder="Enter passphrase shared out of band"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="off"
            />
            <p className="caption">
              Compare the 8-hex key fingerprint displayed on the sending stage with the receiver before long transfers.
            </p>
          </div>
        ) : (
          <p className="caption">
            Unencrypted streams can be decoded by any camera with line-of-sight to your screen.
          </p>
        )}
      </Panel>

      {problem ? (
        <Panel tone="bad">
          <p className="text-bad">{problem}</p>
        </Panel>
      ) : null}

      <Button
        label={phase === 'preparing' ? 'Preparing session' : 'Start sending'}
        loading={phase === 'preparing'}
        disabled={!canStart}
        onClick={() => void start()}
        hint={!canStart ? 'Select a file or enter text above to begin.' : undefined}
      />
    </>
  );
}
