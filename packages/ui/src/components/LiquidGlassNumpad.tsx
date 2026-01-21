export type LiquidGlassNumpadProps = {
  disabled?: boolean;
  className?: string;

  onDigit: (digit: number) => void;
  onBackspace: () => void;
  onClear: () => void;

  onSubmit?: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
};

export function LiquidGlassNumpad({
  disabled,
  className,
  onDigit,
  onBackspace,
  onClear,
  onSubmit,
  submitLabel = 'Enter',
  submitDisabled,
}: LiquidGlassNumpadProps) {
  const isSubmitDisabled = Boolean(disabled || submitDisabled || !onSubmit);

  return (
    <div className={['cs-liquid-numpad', className].filter(Boolean).join(' ')}>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
        <button
          key={d}
          type="button"
          className="cs-liquid-button cs-liquid-numpad__key"
          onClick={() => onDigit(d)}
          disabled={disabled}
          aria-label={`Digit ${d}`}
        >
          {d}
        </button>
      ))}

      <button
        type="button"
        className="cs-liquid-button cs-liquid-button--secondary cs-liquid-numpad__key cs-liquid-numpad__secondary"
        onClick={onClear}
        disabled={disabled}
        aria-label="Clear PIN"
      >
        Clear
      </button>

      <button
        type="button"
        className="cs-liquid-button cs-liquid-numpad__key"
        onClick={() => onDigit(0)}
        disabled={disabled}
        aria-label="Digit 0"
      >
        0
      </button>

      <button
        type="button"
        className="cs-liquid-button cs-liquid-button--secondary cs-liquid-numpad__key cs-liquid-numpad__secondary"
        onClick={onBackspace}
        disabled={disabled}
        aria-label="Backspace"
      >
        ⌫
      </button>

      <button
        type="button"
        className="cs-liquid-button cs-liquid-numpad__submit"
        onClick={onSubmit}
        disabled={isSubmitDisabled}
        aria-label={submitLabel}
      >
        {submitLabel}
      </button>
    </div>
  );
}

