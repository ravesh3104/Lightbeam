/**
 * optical-transfer.test.ts - end-to-end web optical channel tests.
 *
 * Exercises the exact browser pixel pipeline:
 *   prepareTransfer -> TransferSender -> rasterizeRgba -> scaleRgbaImage
 *   -> BrowserQrScanner (jsQR) -> TransferReceiver -> Inbox storage
 */

import { describe, expect, it } from 'vitest';
import {
  FAST_KDF,
  TransferReceiver,
  TransferSender,
  prepareTransfer,
  rasterizeRgba,
} from '@lightbeam/core';
import { scaleRgbaImage } from '../src/components/QrView';
import { clearInbox, listInbox, saveReceivedFile } from '../src/services/inbox';
import { BrowserQrScanner } from '../src/services/scanner';
import { diagnose as diagnoseHints } from '../src/screens/ReceiveScreen';

describe('web optical scanner & fountain roundtrip', () => {
  it('reconstructs a multi-block payload across 25% simulated camera frame loss', async () => {
    await clearInbox();
    const originalText = 'Optical web fountain stream verification. '.repeat(90);
    const data = new TextEncoder().encode(originalText);

    const prepared = await prepareTransfer({
      data,
      name: 'optical-web.txt',
      mime: 'text/plain',
      profile: 'phone',
    });

    const sender = new TransferSender(prepared);
    const receiver = new TransferReceiver();
    const scanner = new BrowserQrScanner('jsqr');

    for (let slot = 0; slot < 300 && !receiver.isComplete; slot++) {
      // Deterministically drop every 4th frame (25% loss).
      if (slot % 4 === 2) continue;
      const symbol = sender.symbolAt(slot);
      const bitmap = scaleRgbaImage(rasterizeRgba(symbol, { scale: 1, quietZone: 4 }), 3);
      const decoded = scanner.decodeRgba(bitmap.data, bitmap.width, bitmap.height);
      expect(decoded).not.toBeNull();
      receiver.accept(decoded!.payload);
    }

    expect(receiver.isComplete).toBe(true);
    const result = receiver.getResult()!;
    expect(result.integrity.ok).toBe(true);
    expect(new TextDecoder().decode(result.payload)).toBe(originalText);

    await saveReceivedFile({
      name: result.manifest.name,
      mime: result.manifest.mime,
      bytes: result.payload,
      sha256: result.manifest.sha,
    });
    const stored = await listInbox();
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('optical-web.txt');
  });

  it('refuses encrypted payloads without the passphrase, then unlocks in memory once supplied', async () => {
    const secretBytes = new TextEncoder().encode('Confidential web transfer payload. '.repeat(30));
    const prepared = await prepareTransfer({
      data: secretBytes,
      name: 'secret.txt',
      mime: 'text/plain',
      profile: 'phone',
      passphrase: 'correct-horse-battery',
      kdf: FAST_KDF,
    });

    const sender = new TransferSender(prepared);
    const receiver = new TransferReceiver();
    const scanner = new BrowserQrScanner('jsqr');

    let terminalPhase = receiver.getProgress().phase;
    for (let slot = 0; slot < 200; slot++) {
      const symbol = sender.symbolAt(slot);
      const bitmap = scaleRgbaImage(rasterizeRgba(symbol, { scale: 1, quietZone: 4 }), 3);
      const decoded = scanner.decodeRgba(bitmap.data, bitmap.width, bitmap.height);
      if (decoded) {
        terminalPhase = receiver.accept(decoded.payload);
        if (terminalPhase === 'failed' || terminalPhase === 'complete') break;
      }
    }

    // Without the passphrase, no decrypted payload may be yielded.
    expect(terminalPhase).toBe('failed');
    expect(receiver.getResult()).toBeNull();

    // Wrong passphrase still fails authentication tag.
    expect(receiver.setPassphrase('wrong-passphrase')).toBe('failed');
    expect(receiver.getResult()).toBeNull();

    // Supplying the right passphrase finishes immediately without another camera frame.
    expect(receiver.setPassphrase('correct-horse-battery')).toBe('complete');
    const unlocked = receiver.getResult();
    expect(unlocked).not.toBeNull();
    expect(new TextDecoder().decode(unlocked!.payload)).toBe(new TextDecoder().decode(secretBytes));
  });

  it('supports raw byte-mode QR frames between browsers via jsQR binaryData', async () => {
    const binary = new Uint8Array(600);
    for (let i = 0; i < binary.length; i++) binary[i] = (i * 73 + 19) & 0xff;

    const prepared = await prepareTransfer({
      data: binary,
      name: 'raw.bin',
      mime: 'application/octet-stream',
      profile: 'balanced',
      wireEncoding: 'raw',
    });

    const sender = new TransferSender(prepared);
    const receiver = new TransferReceiver();
    const scanner = new BrowserQrScanner('jsqr');

    for (let slot = 0; slot < 120 && !receiver.isComplete; slot++) {
      const symbol = sender.symbolAt(slot);
      const bitmap = scaleRgbaImage(rasterizeRgba(symbol, { scale: 1, quietZone: 4 }), 3);
      const decoded = scanner.decodeRgba(bitmap.data, bitmap.width, bitmap.height);
      if (decoded) receiver.accept(decoded.payload);
    }

    expect(receiver.isComplete).toBe(true);
    expect(Array.from(receiver.getResult()!.payload)).toEqual(Array.from(binary));
  });

  it('produces actionable diagnostic hints for unreadable, cropped, and foreign frames', () => {
    const base = new TransferReceiver().getProgress();
    const hints = diagnoseHints({
      ...base,
      framesAccepted: 5,
      framesForeign: 35,
      framesOrphan: 50,
      framesSuspect: 30,
    });
    expect(hints.length).toBeGreaterThanOrEqual(3);
  });
});
