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
  return (
    <div className="er-search-half">
      <div className="er-search-half__center">
        <input
          id={id}
          type="text"
          className={['cs-liquid-input', 'er-search-half__input', className]
            .filter(Boolean)
            .join(' ')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
