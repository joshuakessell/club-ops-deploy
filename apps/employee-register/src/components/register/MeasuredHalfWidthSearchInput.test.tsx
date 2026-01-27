import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MeasuredHalfWidthSearchInput } from './MeasuredHalfWidthSearchInput';

describe('MeasuredHalfWidthSearchInput', () => {
  it('sets visible input width to 50% of the baseline measurement input', async () => {
    render(
      <MeasuredHalfWidthSearchInput
        id="customer-search"
        value=""
        onChange={() => {}}
        placeholder="Start typing name..."
      />
    );

    const visible = screen.getByPlaceholderText('Start typing name...');
    const measure = document.querySelector<HTMLInputElement>('.er-search-half__measure input');
    expect(measure).toBeTruthy();
    if (!measure) {
      throw new Error('Expected measurement input to exist');
    }

    // Stub baseline width
    measure.getBoundingClientRect = () => new DOMRect(0, 0, 600, 0);

    // Wait for effect's rAF tick to apply half-width
    await waitFor(() => {
      expect(visible.style.width).toBe('300px');
    });
  });
});
