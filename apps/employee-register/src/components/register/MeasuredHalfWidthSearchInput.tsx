import { useEffect, useMemo, useRef, useState } from 'react';

type MeasuredHalfWidthSearchInputProps = {
  id: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export function MeasuredHalfWidthSearchInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: MeasuredHalfWidthSearchInputProps) {
  const measureInputRef = useRef<HTMLInputElement | null>(null);
  const [baselineWidthPx, setBaselineWidthPx] = useState<number | null>(null);

  useEffect(() => {
    const el = measureInputRef.current;
    if (!el) return;

    const update = () => {
      const w = el.getBoundingClientRect().width;
      if (Number.isFinite(w) && w > 0) setBaselineWidthPx(w);
    };

    // Initial pass (and a second pass after layout settles).
    update();
    const raf = window.requestAnimationFrame(() => update());

    // Prefer ResizeObserver, but gracefully fall back for environments (e.g. jsdom) where it's missing.
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => update());
      ro.observe(el);
      return () => {
        window.cancelAnimationFrame(raf);
        ro.disconnect();
      };
    }

    const onResize = () => update();
    window.addEventListener('resize', onResize);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const targetWidth = useMemo(() => {
    if (!baselineWidthPx) return null;
    return Math.max(200, baselineWidthPx * 0.5); // guardrail: never too tiny for touch
  }, [baselineWidthPx]);

  return (
    <div className="er-search-half">
      {/* Baseline measurement clone (kept invisible, no layout shift) */}
      <div className="er-search-half__measure" aria-hidden="true">
        <input
          ref={measureInputRef}
          type="text"
          className="cs-liquid-input"
          defaultValue=""
          placeholder=""
          style={{ width: '100%' }}
          disabled={true}
          tabIndex={-1}
        />
      </div>

      {/* Visible input: exactly 50% of baseline width, centered */}
      <div className="er-search-half__center">
        <input
          id={id}
          type="text"
          className={['cs-liquid-input', className].filter(Boolean).join(' ')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          style={targetWidth ? { width: `${targetWidth}px` } : { width: '100%' }}
        />
      </div>
    </div>
  );
}

