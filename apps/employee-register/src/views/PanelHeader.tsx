import type { ReactNode } from 'react';
import './PanelHeader.css';

type PanelHeaderAlign = 'start' | 'center';
type PanelHeaderLayout = 'stacked' | 'inline';
type PanelHeaderSpacing = 'none' | 'sm' | 'md';

export interface PanelHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  align?: PanelHeaderAlign;
  layout?: PanelHeaderLayout;
  spacing?: PanelHeaderSpacing;
  className?: string;
}

export function PanelHeader({
  title,
  subtitle,
  action,
  align = 'start',
  layout = 'stacked',
  spacing = 'md',
  className,
}: PanelHeaderProps) {
  const classes = [
    'er-panel-header',
    align === 'center' ? 'er-panel-header--center' : '',
    layout === 'inline' ? 'er-panel-header--inline' : 'er-panel-header--stacked',
    `er-panel-header--space-${spacing}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const isInline = layout === 'inline';

  return (
    <div className={classes}>
      <div className="er-panel-header__top">
        <div className="er-panel-header__title-group">
          <h2 className="er-card-title">{title}</h2>
          {isInline && subtitle ? <div className="er-card-subtitle">{subtitle}</div> : null}
        </div>
        {action ? <div className="er-panel-header__action">{action}</div> : null}
      </div>
      {!isInline && subtitle ? <div className="er-card-subtitle">{subtitle}</div> : null}
    </div>
  );
}
