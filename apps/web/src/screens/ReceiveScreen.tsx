/**
 * ReceiveScreen.tsx - camera viewfinder, dual-engine QR scanner, and SHA-256 verifier.
 *
 * Supports live camera capture (`getUserMedia` + continuous autofocus + optional
 * torch) as well as decoding from still QR images for desktop/headless workflows.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { formatBytes, sessionCode, type ReceiverProgress } from '@lightbeam/core';
import { Button } from '../components/Controls';
import { KeyValue, Panel, ProgressBar, Row } from '../components/Panel';
import { formatDuration, triggerHaptic, useScreenWakeLock } from '../services/display';
import {
  canWebShareFiles,
  downloadBytes,
  saveReceivedFile,
  shareBrowserFile,
  toSafeBlob,
} from '../services/inbox';
import {
  BrowserQrScanner,
  isCameraAvailable,
  isSecureContextOk,
  useReceiver,
} from '../services/scanner';
import { lookupSession, reportCompletion, type SessionSummary } from '../services/telemetry';
import type { Settings } from '../state/settings';

export interface ReceiveScreenProps {
  settings: Settings;
  expectedCode?: string | null;
  onInboxChanged: () => void;
  onTransferActiveChange: (active: boolean) => void;
  onOpenFiles: () => void;
  onBack: () => void;
}

type Outcome =
  | {
      kind: 'ok';
      name: string;
      mime: string;
      bytes: Uint8Array;
      text: string | null;
      sha256: string;
      seconds: number;
      overhead: number;
    }
  | {
      kind: 'error';
      message: string;
    };

export function ReceiveScreen({
  settings,
  expectedCode,
  onInboxChanged,
  onTransferActiveChange,
  onOpenFiles,
  onBack,
}: ReceiveScreenProps) {
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const [progress, setProgress] = useState<ReceiverProgress | null>(null);
  const [scanMeta, setScanMeta] = useState<{ seen: number; engine: string; decodeMs: number }>({
    seen: 0,
    engine: 'auto',
    decodeMs: 0,
  });
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [expectedSession, setExpectedSession] = useState<SessionSummary | null>(null);
  const [partialPreviewUrl, setPartialPreviewUrl] = useState<string | null>(null);
  const [finalPreviewUrl, setFinalPreviewUrl] = useState<string | null>(null);

  const { receiver, accept } = useReceiver();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const scannerRef = useRef<BrowserQrScanner | null>(null);
  const finishedRef = useRef(false);
  const scanStatsRef = useRef({ seen: 0, engine: 'jsQR', decodeMs: 0 });

  useScreenWakeLock(scanning, settings.keepAwake);

  useEffect(() => {
    onTransferActiveChange(scanning);
    return () => onTransferActiveChange(false);
  }, [scanning, onTransferActiveChange]);

  useEffect(() => {
    if (!expectedCode) {
      setExpectedSession(null);
      return;
    }
    let cancelled = false;
    void lookupSession(expectedCode).then((record) => {
      if (!cancelled) setExpectedSession(record);
    });
    return () => {
      cancelled = true;
    };
  }, [expectedCode]);

  useEffect(() => {
    return () => {
      if (partialPreviewUrl) URL.revokeObjectURL(partialPreviewUrl);
      if (finalPreviewUrl) URL.revokeObjectURL(finalPreviewUrl);
    };
  }, [partialPreviewUrl, finalPreviewUrl]);

  const stopCamera = useCallback(() => {
    setScanning(false);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setTorchSupported(false);
    setTorchOn(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
      receiver.reset();
    };
  }, [stopCamera, receiver]);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    stopCamera();

    const result = receiver.getResult();
    const now = receiver.getProgress();
    setProgress(now);

    if (!result) {
      const message = now.error ?? 'Transfer failed.';
      const passphraseRelated = /passphrase|key|decrypt|tag|authentication/i.test(message);
      setNeedsPassphrase(Boolean(now.awaitingPassphrase || (passphraseRelated && receiver.currentManifest?.enc !== 'none')));
      setOutcome({ kind: 'error', message });
      if (settings.vibrateOnComplete) triggerHaptic('error');
      return;
    }

    const seconds = Math.max(0.05, receiver.elapsedMs() / 1000);
    const overhead = now.blocksTotal > 0 ? now.framesAccepted / now.blocksTotal : 1;
    const throughput = result.payload.byteLength / seconds;

    if (result.manifest.mime.startsWith('image/')) {
      const blob = toSafeBlob(result.payload, result.manifest.mime);
      setFinalPreviewUrl(URL.createObjectURL(blob));
    }

    setOutcome({
      kind: 'ok',
      name: result.manifest.name,
      mime: result.manifest.mime,
      bytes: result.payload,
      text: result.text ?? null,
      sha256: result.manifest.sha,
      seconds,
      overhead,
    });

    void saveReceivedFile({
      name: result.manifest.name,
      mime: result.manifest.mime,
      bytes: result.payload,
      sha256: result.manifest.sha,
    }).then(() => onInboxChanged());

    const reportCode = (expectedCode ?? sessionCode(result.manifest.sid)).toUpperCase();
    void reportCompletion(reportCode, {
      elapsedSeconds: seconds,
      overheadRatio: overhead,
      throughputBytesPerSecond: throughput,
      framesAccepted: now.framesAccepted,
      framesSuspect: now.framesSuspect,
      verified: result.integrity.ok,
    });

    if (settings.vibrateOnComplete) triggerHaptic('ok');
  }, [receiver, stopCamera, expectedCode, onInboxChanged, settings.vibrateOnComplete]);

  const startCamera = useCallback(
    async (requestedFacing = facing) => {
      setCameraError(null);
      if (!isSecureContextOk()) {
        setCameraError('Camera access requires HTTPS or localhost. Open this site over https:// to use the camera.');
        return;
      }
      if (!isCameraAvailable()) {
        setCameraError('This browser does not expose navigator.mediaDevices.getUserMedia.');
        return;
      }

      stopCamera();
      finishedRef.current = false;

      if (!scannerRef.current) {
        scannerRef.current = new BrowserQrScanner(settings.scannerEngine);
      } else {
        scannerRef.current.setPreference(settings.scannerEngine);
      }

      try {
        const videoConstraints: MediaTrackConstraints = {
          facingMode: { ideal: requestedFacing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        };
        (videoConstraints as Record<string, unknown>).focusMode = 'continuous';

        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
        streamRef.current = stream;

        const track = stream.getVideoTracks()[0];
        try {
          const capabilities = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
            focusMode?: string[];
            torch?: boolean;
          };
          if (capabilities.focusMode?.includes('continuous')) {
            await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as never] });
          }
          setTorchSupported(Boolean(capabilities.torch));
        } catch {
          setTorchSupported(false);
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setScanning(true);

        let busy = false;
        const loop = () => {
          if (!streamRef.current) return;
          const video = videoRef.current;
          if (!busy && video && video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
            busy = true;
            void scannerRef.current
              ?.decodeVideoOrImage(video, video.videoWidth, video.videoHeight)
              .then((decoded) => {
                if (decoded && !finishedRef.current) {
                  scanStatsRef.current = {
                    seen: scanStatsRef.current.seen + 1,
                    engine: decoded.engine,
                    decodeMs: decoded.decodeMs,
                  };
                  const phase = accept(decoded.payload);
                  if (phase === 'complete' || phase === 'failed') {
                    finish();
                  }
                }
              })
              .finally(() => {
                busy = false;
              });
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      } catch (error) {
        setCameraError(
          `Camera unavailable: ${(error as Error).message}. Check browser permissions for this origin.`,
        );
      }
    },
    [facing, settings.scannerEngine, stopCamera, accept, finish],
  );

  // Sample receiver progress at 4 Hz so DOM updates never starve camera decoding.
  useEffect(() => {
    if (!scanning) return;
    const timer = setInterval(() => {
      const now = receiver.getProgress();
      setProgress(now);
      setScanMeta({ ...scanStatsRef.current });

      // Live partial preview for unencrypted uncompressed images while blocks arrive.
      if (
        now.manifest &&
        now.manifest.mime.startsWith('image/') &&
        now.manifest.enc === 'none' &&
        now.manifest.codec === 'store' &&
        now.blocksSolved > 0
      ) {
        const part = receiver.partial();
        if (part && part.knownBytes > 0) {
          const blob = toSafeBlob(part.data, now.manifest.mime);
          setPartialPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(blob);
          });
        }
      }

      if (receiver.isComplete || now.phase === 'failed') {
        finish();
      }
    }, 220);
    return () => clearInterval(timer);
  }, [scanning, receiver, finish]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as never] });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  }, [torchOn]);

  const reset = useCallback(() => {
    stopCamera();
    receiver.reset();
    finishedRef.current = false;
    scanStatsRef.current = { seen: 0, engine: settings.scannerEngine === 'jsqr' ? 'jsQR' : 'auto', decodeMs: 0 };
    setOutcome(null);
    setProgress(null);
    setNeedsPassphrase(false);
    setPassphrase('');
    setCameraError(null);
  }, [stopCamera, receiver, settings.scannerEngine]);

  const applyPassphrase = useCallback(() => {
    finishedRef.current = false;
    const phase = receiver.setPassphrase(passphrase);
    if (phase === 'complete' || phase === 'failed') {
      finish();
    } else {
      setProgress(receiver.getProgress());
    }
  }, [passphrase, receiver, finish]);

  /** Allow decoding one or more still QR frame images on desktop/headless setups. */
  const handleStillFrames = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      if (files.length === 0) return;
      setCameraError(null);
      if (!scannerRef.current) {
        scannerRef.current = new BrowserQrScanner(settings.scannerEngine);
      }
      for (const file of files) {
        const bitmapUrl = URL.createObjectURL(file);
        try {
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error(`Could not load image ${file.name}`));
            el.src = bitmapUrl;
          });
          const decoded = await scannerRef.current.decodeVideoOrImage(
            img,
            img.naturalWidth || img.width,
            img.naturalHeight || img.height,
          );
          if (decoded) {
            scanStatsRef.current.seen++;
            const phase = accept(decoded.payload);
            setProgress(receiver.getProgress());
            if (phase === 'complete' || phase === 'failed') {
              finish();
              break;
            }
          }
        } catch (error) {
          setCameraError((error as Error).message);
        } finally {
          URL.revokeObjectURL(bitmapUrl);
        }
      }
      event.target.value = '';
    },
    [settings.scannerEngine, accept, receiver, finish],
  );

  const percent = progress ? Math.round(progress.progress * 100) : 0;
  const hints = useMemo(() => diagnose(progress), [progress]);
  const receivedCode = progress?.manifest ? sessionCode(progress.manifest.sid) : null;
  const codeMismatch = Boolean(
    expectedCode && receivedCode && expectedCode.trim().toUpperCase() !== receivedCode,
  );

  if (outcome?.kind === 'ok') {
    const rate = outcome.seconds > 0 ? outcome.bytes.byteLength / outcome.seconds : 0;
    return (
      <>
        <div className="screen-header">
          <div>
            <h1 className="screen-title">Received and verified</h1>
            <p className="screen-subtitle">
              SHA-256 matches the sender manifest — saved automatically to your browser Files inbox.
            </p>
          </div>
          <span className="badge badge-ok">SHA-256 OK</span>
        </div>

        <Panel title={outcome.name} tone="ok">
          <KeyValue label="Verified size" value={formatBytes(outcome.bytes.byteLength)} />
          <KeyValue label="Elapsed time" value={`${outcome.seconds.toFixed(1)}s`} />
          <KeyValue label="Effective goodput" value={`${formatBytes(rate)}/s`} />
          <KeyValue label="Fountain overhead" value={`${outcome.overhead.toFixed(2)}x`} />
          <KeyValue label="SHA-256" value={`${outcome.sha256.slice(0, 16)}…${outcome.sha256.slice(-8)}`} />

          {outcome.text && outcome.mime.startsWith('text/') ? (
            <pre className="text-preview" data-testid="received-text-preview">
              {outcome.text.slice(0, 20_000)}
            </pre>
          ) : null}

          {finalPreviewUrl ? (
            <img src={finalPreviewUrl} alt={outcome.name} className="image-preview" />
          ) : null}
        </Panel>

        <Row stretch>
          <Button
            label={`Download ${outcome.name}`}
            onClick={() => downloadBytes(outcome.name, outcome.bytes, outcome.mime)}
          />
          {canWebShareFiles() ? (
            <Button
              label="Share file"
              variant="secondary"
              onClick={() => void shareBrowserFile(outcome.name, outcome.bytes, outcome.mime)}
            />
          ) : null}
          {outcome.text ? (
            <Button
              label={copiedText ? 'Copied to clipboard!' : 'Copy text'}
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(outcome.text ?? '');
                setCopiedText(true);
                setTimeout(() => setCopiedText(false), 2000);
              }}
            />
          ) : null}
          <Button label="Open Files inbox" variant="ghost" onClick={onOpenFiles} />
          <Button label="Receive another" variant="ghost" onClick={reset} />
        </Row>
      </>
    );
  }

  if (outcome?.kind === 'error') {
    return (
      <>
        <div className="screen-header">
          <div>
            <h1 className="screen-title">Receive</h1>
            <p className="screen-subtitle">Transfer requires attention</p>
          </div>
          <Button label="Back" variant="ghost" compact onClick={onBack} />
        </div>

        <Panel title="What happened" tone="bad">
          <p className="text-bad">{outcome.message}</p>
          <p className="caption">
            {needsPassphrase
              ? 'All fountain blocks are already in memory — enter the sender passphrase below to authenticate and unlock immediately without restarting the camera.'
              : 'No unverified bytes were saved. Reset and point the camera at the sending screen again.'}
          </p>
        </Panel>

        {needsPassphrase ? (
          <Panel title="Unlock encrypted session" tone="warn">
            <label className="field-label" htmlFor="receive-passphrase-input">
              Passphrase
            </label>
            <input
              id="receive-passphrase-input"
              type="password"
              className="text-input"
              placeholder="Enter sender passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
            <Button label="Unlock payload" onClick={applyPassphrase} />
          </Panel>
        ) : null}

        <Row>
          <Button label="Try again" variant="secondary" onClick={reset} />
          <Button label="Close" variant="ghost" onClick={onBack} />
        </Row>
      </>
    );
  }

  return (
    <>
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Receive</h1>
          <p className="screen-subtitle">
            {expectedCode
              ? `Watching for session ${expectedCode.toUpperCase()}`
              : 'Point your browser camera at the animated QR stream on the sending screen.'}
          </p>
        </div>
        <Button label="Back" variant="ghost" compact onClick={onBack} />
      </div>

      {expectedSession ? (
        <Panel tone="ok">
          <p className="caption">
            Session <strong className="mono">{expectedSession.code}</strong> registered on server:{' '}
            <strong>{expectedSession.name}</strong> ({formatBytes(expectedSession.bytes)}, {expectedSession.blocks}{' '}
            blocks{expectedSession.encrypted ? ', encrypted' : ''}).
          </p>
        </Panel>
      ) : null}

      <div className="video-wrap">
        <video ref={videoRef} className="video-feed" playsInline muted autoPlay />
        {!scanning ? (
          <div className="video-idle">
            <strong>Camera stopped</strong>
            <span className="caption">
              Frames are decoded in browser memory and immediately discarded — nothing is recorded or uploaded.
            </span>
          </div>
        ) : null}
        <div className="reticle" aria-hidden="true" />
      </div>

      <Row stretch>
        {!scanning ? (
          <Button label="Start camera" onClick={() => void startCamera()} />
        ) : (
          <>
            <Button label="Stop camera" variant="secondary" onClick={stopCamera} />
            <Button
              label={`Switch to ${facing === 'environment' ? 'front' : 'rear'} camera`}
              variant="ghost"
              onClick={() => {
                const next = facing === 'environment' ? 'user' : 'environment';
                setFacing(next);
                void startCamera(next);
              }}
            />
            {torchSupported ? (
              <Button
                label={torchOn ? 'Torch off' : 'Torch on'}
                variant="ghost"
                onClick={() => void toggleTorch()}
              />
            ) : null}
          </>
        )}

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-label="Scan QR frame images"
          onChange={(e) => void handleStillFrames(e)}
        />
        <Button
          label="Scan QR image(s)"
          variant="ghost"
          onClick={() => imageInputRef.current?.click()}
        />
        <Button label="Reset" variant="ghost" onClick={reset} />
      </Row>

      {cameraError ? (
        <Panel tone="warn">
          <p className="text-warn">{cameraError}</p>
        </Panel>
      ) : null}

      <Panel title="Live reception status">
        <ProgressBar progress={percent / 100} tone={percent >= 100 ? 'ok' : 'accent'} />

        <KeyValue
          label="Phase"
          value={
            !progress || progress.blocksTotal === 0
              ? scanning
                ? 'Waiting for manifest frame...'
                : 'Idle'
              : `${percent}% · ${progress.blocksSolved}/${progress.blocksTotal} blocks · ${formatDuration(progress.etaSeconds)} left`
          }
        />

        {receivedCode ? (
          <KeyValue
            label="Locked session"
            value={codeMismatch ? `${receivedCode} (expected ${expectedCode?.toUpperCase()})` : receivedCode}
          />
        ) : null}

        {progress?.manifest ? (
          <KeyValue
            label="Incoming file"
            value={
              `${progress.manifest.name} · ${formatBytes(progress.manifest.olen)}` +
              (progress.manifest.codec === 'deflate' ? ' · compressed' : '') +
              (progress.manifest.enc !== 'none' ? ' · encrypted' : '')
            }
          />
        ) : null}

        <KeyValue
          label="Optical goodput"
          value={
            progress
              ? `${progress.goodputFps.toFixed(1)} fps · ${formatBytes(progress.goodputBytesPerSecond)}/s`
              : '0.0 fps'
          }
        />

        <KeyValue
          label="Frame counters"
          value={
            progress
              ? `${progress.framesAccepted} accepted · ${progress.framesSuspect} unreadable · ${progress.framesDuplicate} repeats · ${progress.framesForeign} foreign`
              : `${scanMeta.seen} symbols decoded`
          }
        />

        <KeyValue
          label="Decoder engine"
          value={`${scanMeta.engine}${scanMeta.decodeMs > 0 ? ` (${scanMeta.decodeMs.toFixed(1)} ms/frame)` : ''}`}
        />

        {codeMismatch ? (
          <p className="caption text-warn">
            Warning: locked onto session {receivedCode}, which differs from requested code{' '}
            {expectedCode?.toUpperCase()}.
          </p>
        ) : null}

        {hints.map((hint) => (
          <p key={hint} className="caption text-warn">
            {hint}
          </p>
        ))}

        {partialPreviewUrl ? (
          <div>
            <span className="field-label">Partial image reconstruction</span>
            <img src={partialPreviewUrl} alt="Incoming partial preview" className="image-preview" />
          </div>
        ) : null}
      </Panel>

      {progress?.awaitingPassphrase || needsPassphrase ? (
        <Panel title="Encrypted transfer — enter passphrase" tone="warn">
          <input
            type="password"
            className="text-input"
            placeholder="Passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
          <Button label="Unlock" onClick={applyPassphrase} />
        </Panel>
      ) : null}
    </>
  );
}

export function diagnose(progress: ReceiverProgress | null): string[] {
  if (!progress) return [];
  const hints: string[] = [];
  const { framesAccepted, framesSuspect, framesForeign, framesOrphan, blocksTotal, goodputFps } = progress;

  if (framesSuspect > 25 && framesSuspect > framesAccepted * 0.3) {
    hints.push(
      'Many symbols are detected but fail CRC: hold steadier, fill more of the reticle, or ask the sender for the Phone symbol profile.',
    );
  }
  if (framesOrphan > 40 && blocksTotal === 0) {
    hints.push(
      'Data frames are arriving without the manifest header: ensure the entire white quiet zone around the QR code fits inside the camera frame.',
    );
  }
  if (framesForeign > 30) {
    hints.push('Another QR code is visible in the frame — move closer so only the LightBeam display is in view.');
  }
  if (blocksTotal > 0 && goodputFps < 2) {
    hints.push(
      'Low frame goodput: maximise sender display brightness, enable Cinema dark stage, and avoid overhead glare.',
    );
  }
  return hints;
}
