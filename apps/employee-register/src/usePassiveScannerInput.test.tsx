import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { usePassiveScannerInput } from './usePassiveScannerInput';

function Harness(props: {
  enabled: boolean;
  onCapture: (raw: string) => void;
  onCaptureStart?: () => void;
  onCaptureEnd?: () => void;
  withInput?: boolean;
  focusInput?: boolean;
}) {
  const { reset } = usePassiveScannerInput({
    enabled: props.enabled,
    onCapture: (raw) => props.onCapture(raw),
    onCaptureStart: props.onCaptureStart,
    onCaptureEnd: props.onCaptureEnd,
    idleTimeoutMs: 180,
    enterGraceMs: 35,
    minLength: 4,
    cooldownMs: 400,
    scannerInterKeyMaxMs: 35,
  });

  useEffect(() => {
    reset();
  }, [reset]);

  return (
    <div>
      {props.withInput ? (
        <input aria-label="typed-input" defaultValue="" autoFocus={props.focusInput} />
      ) : (
        <div aria-label="non-input-target" />
      )}
    </div>
  );
}

function keyOnWindow(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
}

function keyOnEl(el: HTMLElement, key: string) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('usePassiveScannerInput', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures printable characters and finalizes after idle timeout', async () => {
    const onCapture = vi.fn();
    const onStart = vi.fn();
    const onEnd = vi.fn();
    render(<Harness enabled={true} onCapture={onCapture} onCaptureStart={onStart} onCaptureEnd={onEnd} />);

    keyOnWindow('A');
    expect(onStart).toHaveBeenCalledTimes(1);
    keyOnWindow('B');
    keyOnWindow('C');
    keyOnWindow('D');

    expect(onCapture).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith('ABCD');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('preserves multi-line scan strings (Enter within payload) and finalizes after idle timeout', async () => {
    const onCapture = vi.fn();
    render(<Harness enabled={true} onCapture={onCapture} />);

    keyOnWindow('A');
    keyOnWindow('B');
    keyOnWindow('C');
    keyOnWindow('D');
    keyOnWindow('Enter');
    // Within grace window, more chars arrive -> Enter is internal newline.
    await vi.advanceTimersByTimeAsync(10);
    keyOnWindow('1');
    keyOnWindow('2');
    keyOnWindow('3');
    keyOnWindow('4');

    await vi.advanceTimersByTimeAsync(200);
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith('ABCD\n1234');
  });

  it('finalizes immediately on Tab terminator without including a tab character', () => {
    const onCapture = vi.fn();
    render(<Harness enabled={true} onCapture={onCapture} />);

    keyOnWindow('1');
    keyOnWindow('2');
    keyOnWindow('3');
    keyOnWindow('4');
    keyOnWindow('Tab');

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith('1234');
  });

  it('does not capture when user is typing in an input element (no active capture sequence)', async () => {
    const onCapture = vi.fn();
    const { getByLabelText } = render(
      <Harness enabled={true} onCapture={onCapture} withInput={true} focusInput={true} />
    );

    const input = getByLabelText('typed-input') as HTMLInputElement;
    keyOnEl(input, 'A');
    keyOnEl(input, 'B');
    keyOnEl(input, 'C');
    keyOnEl(input, 'D');
    await vi.advanceTimersByTimeAsync(250);

    expect(onCapture).not.toHaveBeenCalled();
  });

  it('does not emit captures shorter than the minimum length', async () => {
    const onCapture = vi.fn();
    const onStart = vi.fn();
    const onEnd = vi.fn();
    render(<Harness enabled={true} onCapture={onCapture} onCaptureStart={onStart} onCaptureEnd={onEnd} />);

    keyOnWindow('A');
    expect(onStart).toHaveBeenCalledTimes(1);
    keyOnWindow('B');
    keyOnWindow('C');
    await vi.advanceTimersByTimeAsync(250);

    expect(onCapture).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

