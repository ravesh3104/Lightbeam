/**
 * App.tsx - History API router, persisted web settings, and navigation guard.
 *
 * Maps clean browser URLs (`/`, `/send`, `/receive`, `/files`, `/settings`,
 * `/about`, plus `/receive?code=...` and `/send?profile=...`) to the six
 * LightBeam screens, and warns before navigating away from an active transfer.
 */

import { useCallback, useEffect, useState } from 'react';
import type { DensityProfile } from '@lightbeam/core';
import { Layout, type RouteName } from './components/Layout';
import { AboutScreen } from './screens/AboutScreen';
import { FilesScreen } from './screens/FilesScreen';
import { HomeScreen } from './screens/HomeScreen';
import { ReceiveScreen } from './screens/ReceiveScreen';
import { SendScreen } from './screens/SendScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { listInbox } from './services/inbox';
import { loadSettings, resetSettings, saveSettings, type Settings } from './state/settings';

const PATH_TO_ROUTE: Record<string, RouteName> = {
  '/': 'home',
  '/send': 'send',
  '/s': 'send',
  '/receive': 'receive',
  '/r': 'receive',
  '/files': 'files',
  '/settings': 'settings',
  '/about': 'about',
};

const ROUTE_TO_PATH: Record<RouteName, string> = {
  home: '/',
  send: '/send',
  receive: '/receive',
  files: '/files',
  settings: '/settings',
  about: '/about',
};

function parseCurrentLocation(): {
  route: RouteName;
  code: string | null;
  profile: DensityProfile['id'] | null;
} {
  if (typeof window === 'undefined') {
    return { route: 'home', code: null, profile: null };
  }
  const cleanPath = window.location.pathname.replace(/\/+$/, '') || '/';
  const route = PATH_TO_ROUTE[cleanPath] ?? 'home';
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const rawProfile = params.get('profile');
  const validProfile =
    rawProfile === 'phone' || rawProfile === 'balanced' || rawProfile === 'dense' || rawProfile === 'tablet'
      ? rawProfile
      : null;
  return { route, code, profile: validProfile };
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [loc, setLoc] = useState(() => parseCurrentLocation());
  const [inboxCount, setInboxCount] = useState(0);
  const [transferActive, setTransferActive] = useState(false);

  const refreshInboxCount = useCallback(() => {
    void listInbox().then((items) => setInboxCount(items.length));
  }, []);

  useEffect(() => {
    refreshInboxCount();
  }, [refreshInboxCount]);

  useEffect(() => {
    const onPopState = () => setLoc(parseCurrentLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Warn before closing or reloading a browser tab while a transfer is active.
  useEffect(() => {
    if (!transferActive) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [transferActive]);

  const navigate = useCallback(
    (next: RouteName) => {
      if (next === loc.route) return;
      if (transferActive && typeof window !== 'undefined' && typeof window.confirm === 'function') {
        const proceed = window.confirm('A transfer is currently active. Stop it and leave this screen?');
        if (!proceed) return;
      }
      setTransferActive(false);
      const targetPath = ROUTE_TO_PATH[next];
      if (typeof window !== 'undefined') {
        window.history.pushState(null, '', targetPath);
      }
      setLoc({ route: next, code: null, profile: null });
    },
    [loc.route, transferActive],
  );

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const handleResetSettings = useCallback(() => {
    setSettings(resetSettings());
  }, []);

  const goHome = useCallback(() => navigate('home'), [navigate]);

  return (
    <Layout route={loc.route} inboxCount={inboxCount} onNavigate={navigate}>
      {loc.route === 'send' ? (
        <SendScreen
          settings={settings}
          initialProfile={loc.profile}
          onSettingsChange={updateSettings}
          onTransferActiveChange={setTransferActive}
          onBack={goHome}
        />
      ) : loc.route === 'receive' ? (
        <ReceiveScreen
          settings={settings}
          expectedCode={loc.code}
          onInboxChanged={refreshInboxCount}
          onTransferActiveChange={setTransferActive}
          onOpenFiles={() => navigate('files')}
          onBack={goHome}
        />
      ) : loc.route === 'files' ? (
        <FilesScreen onInboxChanged={refreshInboxCount} onBack={goHome} />
      ) : loc.route === 'settings' ? (
        <SettingsScreen
          settings={settings}
          onChange={updateSettings}
          onReset={handleResetSettings}
          onBack={goHome}
        />
      ) : loc.route === 'about' ? (
        <AboutScreen onBack={goHome} />
      ) : (
        <HomeScreen
          inboxCount={inboxCount}
          onSend={() => navigate('send')}
          onReceive={() => navigate('receive')}
          onFiles={() => navigate('files')}
          onSettings={() => navigate('settings')}
          onAbout={() => navigate('about')}
          onInboxChanged={refreshInboxCount}
        />
      )}
    </Layout>
  );
}
