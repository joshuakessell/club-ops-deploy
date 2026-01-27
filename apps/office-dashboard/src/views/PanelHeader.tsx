import type { ReactNode } from 'react';
import './PanelHeader.css';

export interface PanelHeaderProps {
  title: ReactNode;
  titleAs?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  actions?: ReactNode;
  className?: string;
  titleClassName?: string;
}

export function PanelHeader({
  title,
  titleAs = 'h2',
  actions,
  className,
  titleClassName,
}: PanelHeaderProps) {
  const TitleTag = titleAs;
  return (
    <div className={['panel-header', className].filter(Boolean).join(' ')}>
      <TitleTag className={['panel-title', titleClassName].filter(Boolean).join(' ')}>
        {title}
      </TitleTag>
      {actions ? <div className="panel-header__actions">{actions}</div> : null}
    </div>
  );
}
