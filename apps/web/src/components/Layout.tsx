/**
 * Layout.tsx - responsive navigation bar and PWA install prompt integration.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { VERSION } from '@lightbeam/core';

export type RouteName = 'home' | 'send' | 'receive' | 'files' | 'settings' | 'about';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface LayoutProps {
  route: RouteName;
  inboxCount: number;
  onNavigate: (next: RouteName) => void;
  children: ReactNode;
}

const NAV_ITEMS: Array<{ id: RouteName; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'send', label: 'Send' },
  { id: 'receive', label: 'Receive' },
  { id: 'files', label: 'Files' },
  { id: 'settings', label: 'Settings' },
  { id: 'about', label: 'About' },
];

export function Layout({ route, inboxCount, onNavigate, children }: LayoutProps) {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const triggerInstall = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice.catch(() => undefined);
    setInstallEvent(null);
  };

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <button
            type="button"
            className="brand-btn"
            onClick={() => onNavigate('home')}
            aria-label="LightBeam Home"
          >
            <img src="/icon.svg" alt="" width={28} height={28} />
            <span className="brand-title">LightBeam</span>
            <span className="brand-tag">v{VERSION}</span>
          </button>

          <nav className="nav-links" aria-label="Primary navigation">
            {NAV_ITEMS.map((item) => {
              const active = route === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-btn ${active ? 'active' : ''}`.trim()}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onNavigate(item.id)}
                >
                  <span>{item.label}</span>
                  {item.id === 'files' && inboxCount > 0 ? (
                    <span className="nav-badge" aria-label={`${inboxCount} saved files`}>
                      {inboxCount}
                    </span>
                  ) : null}
                </button>
              );
            })}
            {installEvent ? (
              <button type="button" className="nav-btn active" onClick={() => void triggerInstall()}>
                Install App
              </button>
            ) : null}
          </nav>
        </div>
      </header>

      <main className="app-main">{children}</main>
    </>
  );
}
