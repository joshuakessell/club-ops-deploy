import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './KioskOptionButton.css';

export interface KioskOptionButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'title'
> {
  title: ReactNode;
  subtext?: ReactNode;
  price?: ReactNode;
  stacked?: boolean;
  span?: 1 | 2;
  selected?: boolean;
  staffProposed?: boolean;
  highlight?: boolean;
  pulse?: boolean;
  disabledStyle?: boolean;
  className?: string;
}

export function KioskOptionButton({
  title,
  subtext,
  price,
  stacked = false,
  span = 1,
  selected = false,
  staffProposed = false,
  highlight = false,
  pulse = false,
  disabledStyle = false,
  className,
  disabled,
  ...rest
}: KioskOptionButtonProps) {
  const showStack = stacked || Boolean(subtext) || Boolean(price);
  const classes = [
    'cs-liquid-button',
    'kiosk-option-button',
    span === 2 ? 'span-2' : '',
    selected ? 'cs-liquid-button--selected' : '',
    staffProposed ? 'cs-liquid-button--staff-proposed' : '',
    disabledStyle ? 'cs-liquid-button--disabled' : '',
    highlight ? 'ck-option-highlight' : '',
    pulse ? 'pulse-bright' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} disabled={disabled} {...rest}>
      {showStack ? (
        <div className="kiosk-option-stack">
          <span className="kiosk-option-title">{title}</span>
          {subtext ? <span className="kiosk-option-subtext">{subtext}</span> : null}
          {price ? <span className="kiosk-option-price">{price}</span> : null}
        </div>
      ) : (
        <span className="kiosk-option-title">{title}</span>
      )}
    </button>
  );
}
