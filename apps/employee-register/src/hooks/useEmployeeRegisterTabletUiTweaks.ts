import { useLayoutEffect } from 'react';

type BaselineVars = {
  primaryBtn?: string;
  secondaryBtn?: string;
  label?: string;
  search?: string;
  btnIcon?: string;
};

function px(v: string): string | null {
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return null;
  return `${n}px`;
}

function setVars(root: HTMLElement, vars: BaselineVars) {
  if (vars.primaryBtn) root.style.setProperty('--er-font-btn-primary-base', vars.primaryBtn);
  if (vars.secondaryBtn) root.style.setProperty('--er-font-btn-secondary-base', vars.secondaryBtn);
  if (vars.label) root.style.setProperty('--er-font-label-base', vars.label);
  if (vars.search) root.style.setProperty('--er-font-search-base', vars.search);
  if (vars.btnIcon) root.style.setProperty('--er-font-btn-icon-base', vars.btnIcon);
}

/**
 * Employee Register ONLY:
 * - Measures baseline computed font sizes (before we apply the CSS bump).
 * - Applies `.er-ui-tweaks` class to #root once we have enough data to safely bump sizes.
 */
export function useEmployeeRegisterTabletUiTweaks() {
  useLayoutEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;

    const collected: BaselineVars = {};

    const tryCollect = () => {
      const primaryBtn = document.querySelector<HTMLElement>(
        '.cs-liquid-button:not(.cs-liquid-button--secondary)'
      );
      const secondaryBtn = document.querySelector<HTMLElement>(
        '.cs-liquid-button.cs-liquid-button--secondary'
      );
      const labelEl = document.querySelector<HTMLElement>('label');
      const searchEl = document.getElementById('customer-search');
      const iconEl = document.querySelector<HTMLElement>('.btn-icon');

      if (!collected.primaryBtn && primaryBtn) {
        collected.primaryBtn = px(getComputedStyle(primaryBtn).fontSize) ?? undefined;
      }
      if (!collected.secondaryBtn && secondaryBtn) {
        collected.secondaryBtn = px(getComputedStyle(secondaryBtn).fontSize) ?? undefined;
      }
      if (!collected.label && labelEl) {
        collected.label = px(getComputedStyle(labelEl).fontSize) ?? undefined;
      }
      if (!collected.search && searchEl) {
        collected.search = px(getComputedStyle(searchEl).fontSize) ?? undefined;
      }
      if (!collected.btnIcon && iconEl) {
        collected.btnIcon = px(getComputedStyle(iconEl).fontSize) ?? undefined;
      }

      setVars(root, collected);

      // We can safely enable the CSS bump once we have button + label sizing.
      if (collected.primaryBtn && collected.secondaryBtn && collected.label) {
        root.classList.add('er-ui-tweaks');
        return true;
      }

      return false;
    };

    // Run once immediately.
    if (tryCollect()) return;

    // Observe for late-mounted nodes (customer search, etc.).
    const mo = new MutationObserver(() => {
      if (tryCollect()) {
        mo.disconnect();
      }
    });
    mo.observe(root, { childList: true, subtree: true });

    return () => mo.disconnect();
  }, []);
}
