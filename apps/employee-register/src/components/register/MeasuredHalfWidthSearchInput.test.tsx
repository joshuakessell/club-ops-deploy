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

    const visible = screen.getByPlaceholderText('Start typing name...') as HTMLInputElement;
    const measure = document.querySelector('.er-search-half__measure input') as HTMLInputElement;
    expect(measure).toBeTruthy();

    // Stub baseline width
    measure.getBoundingClientRect = () =>
      ({ width: 600, height: 0, top: 0, left: 0, right: 600, bottom: 0, x: 0, y: 0, toJSON: () => {} }) as any;

    // Wait for effect's rAF tick to apply half-width
    await waitFor(() => {
      expect(visible.style.width).toBe('300px');
    });
  });
});

