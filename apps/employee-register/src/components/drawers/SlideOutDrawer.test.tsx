import { describe, it, expect, vi, beforeAll } from 'vitest';

let render: typeof import('@testing-library/react').render;
let screen: typeof import('@testing-library/react').screen;
let fireEvent: typeof import('@testing-library/react').fireEvent;
let SlideOutDrawer: typeof import('./SlideOutDrawer').SlideOutDrawer;

beforeAll(async () => {
  // React's event system feature-detects PointerEvent at init time. In jsdom it may be missing,
  // which prevents onPointer* handlers from firing. Polyfill it before importing react-dom.
  if (!('PointerEvent' in globalThis)) {
    class PolyfilledPointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, params: MouseEventInit & { pointerId?: number } = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 1;
      }
    }
    (globalThis as unknown as { PointerEvent: typeof PolyfilledPointerEvent }).PointerEvent =
      PolyfilledPointerEvent;
  }

  ({ render, screen, fireEvent } = await import('@testing-library/react'));
  ({ SlideOutDrawer } = await import('./SlideOutDrawer'));
});

describe('SlideOutDrawer', () => {
  it('renders closed drawer with tab label and aria-expanded=false', () => {
    render(
      <SlideOutDrawer side="left" label="Tools" isOpen={false} onOpenChange={() => undefined}>
        <div>Drawer content</div>
      </SlideOutDrawer>
    );

    const tab = screen.getByRole('button', { name: 'Tools' });
    expect(tab).toBeDefined();
    expect(tab.getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking the tab toggles open', () => {
    const onOpenChange = vi.fn();
    render(
      <SlideOutDrawer side="left" label="Tools" isOpen={false} onOpenChange={onOpenChange}>
        <div>Drawer content</div>
      </SlideOutDrawer>
    );

    const tab = screen.getByRole('button', { name: 'Tools' });
    fireEvent.click(tab);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('renders open drawer with aria-expanded=true and backdrop', () => {
    render(
      <SlideOutDrawer side="left" label="Tools" isOpen={true} onOpenChange={() => undefined}>
        <div>Drawer content</div>
      </SlideOutDrawer>
    );

    const tab = screen.getByRole('button', { name: 'Tools' });
    expect(tab.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('slideout-backdrop')).toBeDefined();
  });

  it('dragging open snaps open on release', () => {
    const onOpenChange = vi.fn();
    render(
      <SlideOutDrawer side="left" label="Tools" isOpen={false} onOpenChange={onOpenChange}>
        <div>Drawer content</div>
      </SlideOutDrawer>
    );

    const tab = screen.getByRole('button', { name: 'Tools' });

    fireEvent.pointerDown(tab, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(tab, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(tab, { clientX: 300, pointerId: 1 });

    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('dragging close snaps closed on release', () => {
    const onOpenChange = vi.fn();
    render(
      <SlideOutDrawer side="left" label="Tools" isOpen={true} onOpenChange={onOpenChange}>
        <div>Drawer content</div>
      </SlideOutDrawer>
    );

    const tab = screen.getByRole('button', { name: 'Tools' });

    fireEvent.pointerDown(tab, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(tab, { clientX: 0, pointerId: 1 });
    fireEvent.pointerUp(tab, { clientX: 0, pointerId: 1 });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
