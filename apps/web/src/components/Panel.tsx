/**
 * Panel.tsx - surface containers, key/value rows, and progress bars.
 */

import type { ReactNode } from 'react';

export interface PanelProps {
  title?: string;
  tone?: 'default' | 'ok' | 'warn' | 'bad';
  children: ReactNode;
  className?: string;
}

export function Panel({ title, tone = 'default', children, className = '' }: PanelProps) {
  const toneClass =
    tone === 'ok' ? 'panel-ok' : tone === 'warn' ? 'panel-warn' : tone === 'bad' ? 'panel-bad' : '';
  return (
    <section className={`panel ${toneClass} ${className}`.trim()}>
      {title ? <h2 className="panel-title">{title}</h2> : null}
      {children}
    </section>
  );
}

export interface KeyValueProps {
  label: string;
  value: string;
}

export function KeyValue({ label, value }: KeyValueProps) {
  return (
    <div className="kv-row">
      <span className="kv-label">{label}</span>
      <span className="kv-value">{value}</span>
    </div>
  );
}

export interface ProgressBarProps {
  progress: number;
  tone?: 'accent' | 'ok' | 'warn';
  label?: string;
}

export function ProgressBar({ progress, tone = 'accent', label = 'Transfer progress' }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const percent = Math.round(clamped * 100);
  const fillTone = tone === 'ok' ? 'progress-fill-ok' : tone === 'warn' ? 'progress-fill-warn' : '';
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className={`progress-fill ${fillTone}`.trim()} style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Row({ children, stretch = false }: { children: ReactNode; stretch?: boolean }) {
  return <div className={`row ${stretch ? 'row-stretch' : ''}`.trim()}>{children}</div>;
}
