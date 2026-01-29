import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { useScanCaptureInput } from './useScanCaptureInput';

function Harness(props: {
  enabled: boolean;
  onCapture: (raw: string) => void;
  onCancel?: () => void;
}) {
  const { scanInputRef, scanInputHandlers } = useScanCaptureInput({
    enabled: props.enabled,
    onCapture: props.onCapture,
    onCancel: props.onCancel,
    idleTimeoutMs: 120,
  });

  return <textarea ref={scanInputRef} aria-label="scan-input" {...scanInputHandlers} />;
}

describe('useScanCaptureInput', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures input after idle timeout', async () => {
    const onCapture = vi.fn();
    const { getByLabelText } = render(<Harness enabled={true} onCapture={onCapture} />);
    const el = getByLabelText('scan-input') as HTMLTextAreaElement;

    el.value = 'ABC';
    fireEvent.input(el);

    expect(onCapture).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(140);

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith('ABC');
  });

  it('preserves multi-line scan strings', async () => {
    const onCapture = vi.fn();
    const { getByLabelText } = render(<Harness enabled={true} onCapture={onCapture} />);
    const el = getByLabelText('scan-input') as HTMLTextAreaElement;

    el.value = 'A\nB';
    fireEvent.input(el);

    await vi.advanceTimersByTimeAsync(140);
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith('A\nB');
  });

  it('finalizes immediately on Tab key', () => {
    const onCapture = vi.fn();
    const { getByLabelText } = render(<Harness enabled={true} onCapture={onCapture} />);
    const el = getByLabelText('scan-input') as HTMLTextAreaElement;

    el.value = '12';
    fireEvent.input(el);
    fireEvent.keyDown(el, { key: 'Tab' });

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith('12');
  });

  it('cancels on Escape and does not emit a capture', async () => {
    const onCapture = vi.fn();
    const onCancel = vi.fn();
    const { getByLabelText } = render(
      <Harness enabled={true} onCapture={onCapture} onCancel={onCancel} />
    );
    const el = getByLabelText('scan-input') as HTMLTextAreaElement;

    el.value = 'X';
    fireEvent.input(el);
    fireEvent.keyDown(el, { key: 'Escape' });

    await vi.advanceTimersByTimeAsync(140);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('re-focuses the hidden input on blur when enabled', async () => {
    const onCapture = vi.fn();
    const focusSpy = vi.spyOn(HTMLTextAreaElement.prototype, 'focus');
    const { getByLabelText } = render(<Harness enabled={true} onCapture={onCapture} />);
    const el = getByLabelText('scan-input') as HTMLTextAreaElement;

    fireEvent.blur(el);
    await vi.advanceTimersByTimeAsync(0);

    expect(focusSpy).toHaveBeenCalled();
    focusSpy.mockRestore();
  });
});
