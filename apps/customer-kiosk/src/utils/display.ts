import { t, type Language } from '../i18n';

// Map rental types to display names
export function getRentalDisplayName(rental: string, lang: Language | null | undefined): string {
  switch (rental) {
    case 'LOCKER':
      return t(lang, 'locker');
    case 'STANDARD':
      return t(lang, 'rental.standardDisplay');
    case 'DOUBLE':
      return t(lang, 'rental.doubleDisplay');
    case 'SPECIAL':
      return t(lang, 'rental.specialDisplay');
    case 'GYM_LOCKER':
      return t(lang, 'gymLocker');
    default:
      return rental;
  }
}

export function getPaymentLineItemDisplayDescription(
  description: string,
  lang: Language | null | undefined
): string {
  // Server currently sends English descriptions; map known ones for kiosk display.
  // If unknown, fall back to server text.
  switch (description) {
    case 'Locker':
      return t(lang, 'lineItem.locker');
    case 'Gym Locker':
      return t(lang, 'lineItem.gymLocker');
    case 'Gym Locker (no cost)':
      return t(lang, 'lineItem.gymLockerNoCost');
    case 'Standard Room':
      return t(lang, 'lineItem.standardRoom');
    case 'Double Room':
      return t(lang, 'lineItem.doubleRoom');
    case 'Special Room':
      return t(lang, 'lineItem.specialRoom');
    case 'Membership Fee':
      return t(lang, 'lineItem.membershipFee');
    case '6 Month Membership':
      return t(lang, 'lineItem.sixMonthMembership');
    case 'Card Payment':
      return t(lang, 'lineItem.cardPayment');
    default:
      return description;
  }
}
