import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useScannerInput } from './useScannerInput';

function Harness(props: {
  enabled: boolean;
  onCapture: (raw: string) => void;
  onCancel?: () => void;
}) {
  const { inputRef, handleBlur } = useScannerInput({
    enabled: props.enabled,
    onCapture: ({ raw }) => props.onCapture(raw),
    onCancel: props.onCancel,
    idleTimeoutMs: 75,
    enterGraceMs: 35,
  });

  return <textarea ref={inputRef} onBlur={handleBlur} aria-label="hidden-scan-input" />;
}

function key(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
}

describe('useScannerInput', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures printable characters and finalizes after idle timeout', async () => {
    const onCapture = vi.fn();
    render(<Harness enabled={true} onCapture={onCapture} />);

    key('A');
    key('B');
    key('C');

    expect(onCapture).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(80);

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith('ABC');
  });

  it('finalizes an Enter-terminated scan quickly (common suffix)', async () => {
    const onCapture = vi.fn();
    render(<Harness enabled={true} onCapture={onCapture} />);

    key('A');
    key('Enter');
    // Enter acts as terminator if nothing else arrives quickly.
    await vi.advanceTimersByTimeAsync(40);

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith('A');
  });

  it('preserves multi-line scan strings (Enter within payload) and finalizes after idle timeout', async () => {
    const onCapture = vi.fn();
    render(<Harness enabled={true} onCapture={onCapture} />);

    key('A');
    key('Enter');
    // Within the grace window, more characters arrive -> Enter is treated as internal newline.
    await vi.advanceTimersByTimeAsync(10);
    key('B');

    await vi.advanceTimersByTimeAsync(80);

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith('A\nB');
  });

  it('finalizes immediately on Tab terminator without including a tab character', () => {
    const onCapture = vi.fn();
    render(<Harness enabled={true} onCapture={onCapture} />);

    key('1');
    key('2');
    key('Tab');

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith('12');
  });

  it('ignores modifier-key combos (ctrl/meta/alt) and does not include them in scans', async () => {
    const onCapture = vi.fn();
    render(<Harness enabled={true} onCapture={onCapture} />);

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'X', ctrlKey: true, cancelable: true })
    );
    key('Y');
    await vi.advanceTimersByTimeAsync(80);

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith('Y');
  });

  it('calls onCancel on Escape and clears buffered input', async () => {
    const onCapture = vi.fn();
    const onCancel = vi.fn();
    render(<Harness enabled={true} onCapture={onCapture} onCancel={onCancel} />);

    key('X');
    key('Escape');

    expect(onCancel).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('re-focuses the hidden input on blur (scan mode resilience)', async () => {
    const onCapture = vi.fn();
    const focusSpy = vi.spyOn(HTMLTextAreaElement.prototype, 'focus');
    const { getByLabelText } = render(<Harness enabled={true} onCapture={onCapture} />);

    const el = getByLabelText('hidden-scan-input') as HTMLTextAreaElement;
    // Trigger blur; hook should re-focus on next tick.
    el.blur();
    await vi.advanceTimersByTimeAsync(0);

    expect(focusSpy).toHaveBeenCalled();
    focusSpy.mockRestore();
  });
});
