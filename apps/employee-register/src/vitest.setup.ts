import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { closeAllLaneSessionClients } from '@club-ops/shared';

afterEach(() => {
  cleanup();
  // `ModalFrame` portals render into `document.body`; ensure nothing persists between tests.
  document.body.innerHTML = '';
  closeAllLaneSessionClients();
  vi.useRealTimers();
  vi.clearAllMocks();
});
