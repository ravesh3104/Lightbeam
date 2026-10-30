/**
 * LoopbackBench.tsx - live in-browser optical loopback simulator.
 *
 * Lets anyone on a single desktop or laptop browser watch the full protocol run
 * end to end without needing a second physical device in hand:
 *
 *   TransferSender.symbolAt(slot)
 *     -> rasterizeRgba (real QR bitmap)
 *     -> simulated optical channel (configurable frame-drop %)
 *     -> jsQR pixel decoder
 *     -> TransferReceiver.accept()
 *     -> SHA-256 verification + IndexedDB Inbox save
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TransferReceiver,
  TransferSender,
  formatBytes,
  prepareTransfer,
  rasterizeRgba,
  type EncodedSymbol,
  type ReceiverProgress,
} from '@lightbeam/core';
import { BrowserQrScanner } from '../services/scanner';
import { saveReceivedFile } from '../services/inbox';
import { registerSession, reportCompletion } from '../services/telemetry';
import { Button } from './Controls';
import { KeyValue, Panel, ProgressBar, Row } from './Panel';
import { QrView, scaleRgbaImage } from './QrView';

export interface LoopbackBenchProps {
  onInboxChanged: () => void;
  onOpenInbox: () => void;
}

const SAMPLE_MESSAGE = [
  'LightBeam Optical Fountain Transfer — Live Browser Loopback',
  '===========================================================',
  'Every frame rendered on the left is rasterised into RGBA pixels,',
  'subjected to simulated camera frame loss, decoded from pixels by jsQR,',
  'peeled by the Luby Transform fountain decoder, and verified with SHA-256.',
  '',
  'Missed frames need no retransmission: any subset of ~1.10x K frames',
  'reconstructs the exact original payload.',
].join('\n');

export function LoopbackBench({ onInboxChanged, onOpenInbox }: LoopbackBenchProps) {
  const [payloadText, setPayloadText] = useState(SAMPLE_MESSAGE);
  const [lossPercent, setLossPercent] = useState(20);
  const [running, setRunning] = useState(false);
  const [symbol, setSymbol] = useState<EncodedSymbol | null>(null);
  const [progress, setProgress] = useState<ReceiverProgress | null>(null);
  const [stats, setStats] = useState({ sent: 0, dropped: 0, decoded: 0 });
  const [doneSummary, setDoneSummary] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lossRef = useRef(lossPercent);
  lossRef.current = lossPercent;

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRunning(false);
  }, []);

  useEffect(() => stop, [stop]);

  const startDemo = useCallback(async () => {
    stop();
    setDoneSummary(null);
    setProgress(null);
    setStats({ sent: 0, dropped: 0, decoded: 0 });

    const data = new TextEncoder().encode(payloadText.trim() || SAMPLE_MESSAGE);
    const prepared = await prepareTransfer({
      data,
      name: 'loopback-demo.txt',
      mime: 'text/plain',
      profile: 'phone',
    });

    void registerSession({
      sessionId: prepared.sessionId,
      code: prepared.code,
      name: prepared.manifest.name,
      mime: prepared.manifest.mime,
      bytes: prepared.originalPayload.length,
      wireBytes: prepared.wirePayload.length,
      blockSize: prepared.manifest.bs,
      blocks: prepared.manifest.k,
      profile: prepared.plan.profile.id,
      encrypted: false,
      codec: prepared.manifest.codec,
      platform: 'web',
    });

    const sender = new TransferSender(prepared);
    const receiver = new TransferReceiver();
    const scanner = new BrowserQrScanner('jsqr');

    let slot = 0;
    let sent = 0;
    let dropped = 0;
    let decodedCount = 0;

    setRunning(true);

    timerRef.current = setInterval(() => {
      const nextSymbol = sender.symbolAt(slot);
      sender.markShown(slot);
      slot++;
      sent++;
      setSymbol(nextSymbol);

      // Simulate optical channel loss (motion blur / blink / exposure overlap).
      if (Math.random() * 100 < lossRef.current) {
        dropped++;
        setStats({ sent, dropped, decoded: decodedCount });
        setProgress(receiver.getProgress());
        return;
      }

      const raster = rasterizeRgba(nextSymbol, { scale: 1, quietZone: 4 });
      const cameraFrame = scaleRgbaImage(raster, 3);
      const hit = scanner.decodeRgba(cameraFrame.data, cameraFrame.width, cameraFrame.height);
      if (hit) {
        decodedCount++;
        const phase = receiver.accept(hit.payload);
        const nowProgress = receiver.getProgress();
        setProgress(nowProgress);
        setStats({ sent, dropped, decoded: decodedCount });

        if (phase === 'complete') {
          stop();
          const result = receiver.getResult();
          if (result) {
            const elapsed = Math.max(0.05, receiver.elapsedMs() / 1000);
            const overhead = nowProgress.blocksTotal > 0 ? decodedCount / nowProgress.blocksTotal : 1;
            setDoneSummary(
              `Verified ${formatBytes(result.payload.byteLength)} in ${elapsed.toFixed(1)}s ` +
                `(${sent} frames shown, ${dropped} dropped by simulated channel, ${overhead.toFixed(2)}x fountain overhead).`,
            );
            void saveReceivedFile({
              name: result.manifest.name,
              mime: result.manifest.mime,
              bytes: result.payload,
              sha256: result.manifest.sha,
            }).then(() => onInboxChanged());
            void reportCompletion(prepared.code, {
              elapsedSeconds: elapsed,
              overheadRatio: overhead,
              throughputBytesPerSecond: result.payload.byteLength / elapsed,
              framesAccepted: nowProgress.framesAccepted,
              framesSuspect: nowProgress.framesSuspect,
              verified: result.integrity.ok,
            });
          }
        }
      }
    }, 85);
  }, [payloadText, stop, onInboxChanged]);

  const pct = progress ? Math.round(progress.progress * 100) : 0;

  return (
    <Panel title="Interactive Single-Tab Optical Loopback">
      <p className="caption">
        No second device nearby? Run a real optical transfer right in this tab: the sender renders QR symbols into
        pixels, drops a configurable fraction of frames, and feeds the surviving bitmaps through <code>jsQR</code> into{' '}
        <code>TransferReceiver</code>.
      </p>

      <div className="grid-two">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <label className="field-label" htmlFor="loopback-text">
            Test message payload
          </label>
          <textarea
            id="loopback-text"
            className="text-area"
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
            disabled={running}
          />
          <label className="field-label" htmlFor="loopback-loss">
            Simulated camera frame loss: <strong className="mono">{lossPercent}%</strong>
          </label>
          <input
            id="loopback-loss"
            type="range"
            min={0}
            max={50}
            step={5}
            value={lossPercent}
            onChange={(e) => setLossPercent(Number(e.target.value))}
          />
          <Row>
            {!running ? (
              <Button label="Run optical loopback" variant="secondary" compact onClick={() => void startDemo()} />
            ) : (
              <Button label="Stop loopback" variant="danger" compact onClick={stop} />
            )}
            {doneSummary ? (
              <Button label="View in Files inbox" variant="ghost" compact onClick={onOpenInbox} />
            ) : null}
          </Row>
        </div>

        <div className="qr-stage" style={{ minHeight: '240px' }}>
          {symbol ? (
            <QrView symbol={symbol} size={184} />
          ) : (
            <div className="caption" style={{ textAlign: 'center', maxWidth: '240px' }}>
              Press <strong>Run optical loopback</strong> to watch fountain frames stream and peel live.
            </div>
          )}
          <div style={{ width: '100%' }}>
            <ProgressBar progress={doneSummary ? 1 : pct / 100} tone={doneSummary ? 'ok' : 'accent'} />
          </div>
          <div style={{ width: '100%' }}>
            <KeyValue label="Frames shown / dropped" value={`${stats.sent} shown · ${stats.dropped} lost`} />
            <KeyValue
              label="Blocks reconstructed"
              value={progress ? `${progress.blocksSolved} / ${progress.blocksTotal}` : '0 / 0'}
            />
          </div>
          {doneSummary ? <p className="caption text-ok">{doneSummary}</p> : null}
        </div>
      </div>
    </Panel>
  );
}
