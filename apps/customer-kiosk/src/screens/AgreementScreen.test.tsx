import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { AgreementScreen, type Agreement } from './AgreementScreen';

describe('AgreementScreen', () => {
  it('does not clear the signature canvas immediately after signatureData updates while modal is open', async () => {
    const agreement: Agreement = {
      id: 'agreement-1',
      version: '1',
      title: 'Agreement',
      bodyText: '<p>Terms</p>',
    };

    const agreementScrollRef = React.createRef<HTMLDivElement>();
    const signatureCanvasRef = React.createRef<HTMLCanvasElement>();

    const clear1 = vi.fn();
    const clear2 = vi.fn();

    const baseProps = {
      customerPrimaryLanguage: 'EN' as const,
      agreement,
      agreed: true,
      signatureData: null as string | null,
      hasScrolledAgreement: true,
      isSubmitting: false,
      orientationOverlay: null,
      welcomeOverlay: null,
      agreementScrollRef,
      signatureCanvasRef,
      onAgreeChange: vi.fn(),
      onSignatureStart: vi.fn(),
      onSignatureMove: vi.fn(),
      onSignatureEnd: vi.fn(),
      onSubmit: vi.fn(),
    };

    const { rerender } = render(<AgreementScreen {...baseProps} onClearSignature={clear1} />);

    // Open the signature modal.
    act(() => {
      screen.getByRole('button', { name: /tap to sign/i }).click();
    });

    // The modal opens and should clear once (fresh canvas).
    expect(await screen.findByRole('dialog', { name: 'Signature' })).toBeDefined();
    await act(async () => {});
    expect(clear1).toHaveBeenCalledTimes(1);

    // Now simulate a parent rerender while the modal is still open (e.g. signatureData updated on pen-up),
    // and also pass a new onClearSignature reference (previously caused immediate re-clear).
    rerender(
      <AgreementScreen
        {...baseProps}
        signatureData="data:image/png;base64,abc"
        onClearSignature={clear2}
      />
    );
    await act(async () => {});

    // Regression check: should NOT clear again just because props/functions changed.
    expect(clear1).toHaveBeenCalledTimes(1);
    expect(clear2).toHaveBeenCalledTimes(0);
  });
});
