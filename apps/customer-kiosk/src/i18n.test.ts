import { describe, expect, it } from 'vitest';
import { translations, t } from './i18n';

describe('customer-kiosk i18n', () => {
  it('Spanish locale covers all English keys', () => {
    const enKeys = Object.keys(translations.EN).sort();
    const esKeys = Object.keys(translations.ES).sort();
    expect(esKeys).toEqual(enKeys);
  });

  it('falls back to English when a Spanish key is missing', () => {
    const key: keyof typeof translations.EN = 'welcome';
    const original = translations.ES[key];
    // Simulate an accidental missing translation at runtime
    delete translations.ES[key];
    try {
      expect(t('ES', key)).toBe(translations.EN[key]);
    } finally {
      if (original === undefined) {
        delete translations.ES[key];
      } else {
        translations.ES[key] = original;
      }
    }
  });

  it('replaces params', () => {
    expect(t('EN', 'selection.welcomeWithName', { name: 'Josh' })).toBe('Welcome, Josh');
  });
});
