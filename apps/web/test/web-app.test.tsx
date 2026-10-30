/**
 * web-app.test.tsx - component, routing, settings, and inbox tests for @lightbeam/web.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DENSITY_PROFILES } from '@lightbeam/core';
import App from '../src/App';
import { clearInbox, saveReceivedFile } from '../src/services/inbox';

beforeEach(async () => {
  localStorage.clear();
  await clearInbox();
  window.history.replaceState(null, '', '/');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/health')) {
        return new Response(
          JSON.stringify({
            ok: true,
            service: 'lightbeam-server',
            version: '1.0.0',
            uptimeSeconds: 42,
            sessions: 3,
            storesFileContent: false,
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/api/stats')) {
        return new Response(
          JSON.stringify({
            total: 3,
            completed: 2,
            failed: 0,
            bytesSent: 8192,
            medianOverhead: 1.11,
            medianSeconds: 4,
            byPlatform: { 'desktop-web': 3 },
            byProfile: { balanced: 3 },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ code: 'ABCD234' }), { status: 201 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('@lightbeam/web React application', () => {
  it('renders the Home screen with live server telemetry and navigates all 6 screens', async () => {
    render(<App />);

    expect(screen.getByText(/Send a file through the air, screen to camera/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/2 of 3 sessions/i)).toBeInTheDocument();
      expect(screen.getByText(/Zero file bytes on server/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'About' }));
    expect(screen.getByRole('heading', { name: /About LightBeam/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Receive' }));
    expect(screen.getByRole('heading', { name: 'Receive' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    await waitFor(() => {
      expect(screen.getByText(/Nothing stored yet/i)).toBeInTheDocument();
    });
  });

  it('derives symbol density labels directly from DENSITY_PROFILES with exact ISO 18004 module counts', () => {
    window.history.replaceState(null, '', '/send');
    render(<App />);

    for (const profile of DENSITY_PROFILES) {
      const modules = 17 + 4 * profile.version;
      expect(screen.getByRole('radio', { name: new RegExp(`${modules}x${modules}`) })).toBeInTheDocument();
    }
  });

  it('prepares and streams a text payload on the Send screen with a 7-character session code', async () => {
    window.history.replaceState(null, '', '/send');
    render(<App />);

    const textarea = screen.getByLabelText(/Or paste text/i);
    fireEvent.change(textarea, { target: { value: 'Hello over optical fountain QR!' } });

    expect(screen.getByTestId('send-estimate')).toHaveTextContent(/modules/i);

    fireEvent.click(screen.getByRole('button', { name: /Start sending/i }));

    await waitFor(() => {
      expect(screen.getByTestId('qr-symbol')).toBeInTheDocument();
    });
    const code = screen.getByTestId('session-code').textContent ?? '';
    expect(code).toMatch(/^[A-Z2-9]{7}$/);

    fireEvent.click(screen.getByRole('button', { name: /Stop sending/i }));
    expect(screen.getByRole('heading', { name: 'Send' })).toBeInTheDocument();
  });

  it('lists, previews, and deletes verified received files in the browser Inbox', async () => {
    await saveReceivedFile({
      name: '../unsafe/hello-world.txt',
      mime: 'text/plain',
      bytes: new TextEncoder().encode('Verified optical message'),
      sha256: 'a'.repeat(64),
    });

    window.history.replaceState(null, '', '/files');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('inbox-item')).toBeInTheDocument();
    });
    // Path traversal components must have been stripped by sanitiseFileName.
    expect(screen.getByText('hello-world.txt')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByText('Verified optical message')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Delete all received files/i }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm delete all/i }));

    await waitFor(() => {
      expect(screen.queryByTestId('inbox-item')).not.toBeInTheDocument();
    });
  });

  it('persists preferences to localStorage and supports resetting to defaults', async () => {
    window.history.replaceState(null, '', '/settings');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('radio', { name: '24 fps' }));
    expect(JSON.parse(localStorage.getItem('lightbeam:web-settings:v1') ?? '{}').fps).toBe(24);

    fireEvent.click(screen.getByRole('button', { name: /Reset preferences to defaults/i }));
    expect(JSON.parse(localStorage.getItem('lightbeam:web-settings:v1') ?? '{}').fps).toBe(15);
  });
});
