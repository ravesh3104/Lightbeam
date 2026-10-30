/**
 * Controls.tsx - accessible buttons, radio chip groups, and toggle switches.
 *
 * Written without external UI libraries so touch targets (48 px minimum),
 * ARIA semantics (`radiogroup`/`radio`, `switch`), and keyboard navigation are
 * completely predictable across desktop and mobile browsers.
 */

import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  hint?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  compact?: boolean;
  hero?: boolean;
  loading?: boolean;
}

export function Button({
  label,
  hint,
  variant = 'primary',
  compact = false,
  hero = false,
  loading = false,
  disabled,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    `btn-${variant}`,
    compact ? 'btn-compact' : '',
    hero ? 'hero-cta' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} disabled={disabled || loading} {...rest}>
      <span className={hero ? 'hero-cta-title' : undefined}>{loading ? `${label}...` : label}</span>
      {hint ? <span className="btn-hint">{hint}</span> : null}
    </button>
  );
}

export interface ChoiceOption {
  value: string;
  label: string;
  hint?: string;
}

export interface ChoiceProps {
  label: string;
  options: ChoiceOption[];
  value: string;
  onChange: (value: string) => void;
}

export function Choice({ label, options, value, onChange }: ChoiceProps) {
  return (
    <div className="choice-group" role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`choice-chip ${selected ? 'selected' : ''}`.trim()}
            onClick={() => onChange(option.value)}
          >
            <span>{option.label}</span>
            {selected && option.hint ? <span className="btn-hint">{option.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface SwitchRowProps {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}

export function SwitchRow({ label, hint, value, onValueChange }: SwitchRowProps) {
  return (
    <div className="switch-row">
      <div>
        <div className="switch-label">{label}</div>
        {hint ? <div className="switch-hint">{hint}</div> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        className="switch-toggle"
        onClick={() => onValueChange(!value)}
      >
        <span className="switch-thumb" />
      </button>
    </div>
  );
}
