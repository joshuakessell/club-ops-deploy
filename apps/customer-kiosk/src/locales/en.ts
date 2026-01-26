// Customer Kiosk locale (English)
//
// Add new UI strings here first, then add the same key to `es.ts`.
// Key convention:
// - `common.*` for shared/common UI
// - `a11y.*` for accessibility labels
// - `orientation.*`, `membership.*`, `selection.*`, `waitlist.*`, `upgrade.*`, `renewal.*`, `payment.*`
//
// Prefer sentence keys with simple `{param}` placeholders.
import { AGREEMENT_LEGAL_BODY_HTML_BY_LANG } from '@club-ops/shared';

export const en = {
  // Brand / a11y
  'brand.clubName': 'Club Dallas',
  'a11y.welcomeDialog': 'Welcome',
  'a11y.signatureDialog': 'Signature',

  // Welcome
  welcome: 'Welcome',
  'selection.welcomeWithName': 'Welcome, {name}',

  // Language selection
  selectLanguage: 'Select Language / Seleccione Idioma',
  english: 'English',
  spanish: 'Español',

  // Lane selection
  'lane.selectTitle': 'Select Lane',
  'lane.selectSubtitle': 'Choose your register to begin.',
  'lane.lane1': 'Lane 1',
  'lane.lane2': 'Lane 2',
  'lane.register1': 'Register 1',
  'lane.register2': 'Register 2',

  // Orientation
  'orientation.title': 'Portrait mode required',
  'orientation.body': 'Please rotate the device to portrait to continue.',

  // Common
  'common.ok': 'OK',
  'common.cancel': 'Cancel',
  'common.accept': 'Accept',
  'common.decline': 'Decline',
  'common.you': 'You',
  'common.staff': 'Staff',
  'kiosk.locked.title': 'Please see attendant',
  'kiosk.locked.body':
    'This lane is still being completed. Please see attendant to finish checkout.',

  // Past due
  pastDueBlocked: 'Please see the front desk to resolve your balance.',

  // Payment
  paymentPending: 'Please present payment to the employee',
  'payment.charges': 'Charges',
  totalDue: 'Total Due',
  paymentIssueSeeAttendant: 'Payment issue — please see attendant',

  // Agreement
  agreementTitle: 'Club Agreement',
  agreementPlaceholder: 'Agreement content will be displayed here.',
  scrollRequired: 'Please scroll to the bottom of the agreement to continue.',
  iAgree: 'I agree',
  signatureRequired: 'Signature required to continue',
  'agreement.readAndScrollToContinue':
    'Read the agreement, and scroll to the bottom to continue...',
  'agreement.pleaseCheckToContinue': 'Please check to continue',
  'agreement.tapToSign': 'Tap to Sign',
  'agreement.signed': 'Signed',
  'agreement.sign': 'Sign',
  'agreement.legalBodyHtml': AGREEMENT_LEGAL_BODY_HTML_BY_LANG.EN,
  clear: 'Clear',
  submit: 'Submit',
  submitting: 'Submitting...',

  // Assignment / completion
  thankYou: 'Thank you!',
  assignmentComplete: 'Your check-in is being processed...',
  room: 'Room',
  checkoutAt: 'Checkout Time',

  // Selection state
  proposed: 'Proposed',
  selected: 'Selected',
  confirmSelection: 'Confirm Selection',
  confirming: 'Confirming...',
  acknowledge: 'Acknowledge',
  acknowledging: 'Acknowledging...',
  staffHasLocked: 'Staff has locked this selection. Please acknowledge to continue.',
  'selection.staffSuggestionHint': 'Staff suggestion — tap the highlighted option to accept',
  'selection.yourSelectionWaiting': 'Your selection — waiting for staff to confirm',
  'guidance.pleaseSelectOne': 'Please select one',
  'selection.pendingApproval': 'Waiting for approval',

  // Membership section
  'membership.level': 'Membership Level:',
  'membership.member': 'Member',
  'membership.nonMember': 'Non-Member',
  'membership.expired': 'Expired',
  'membership.purchase6Month': 'Purchase 6 Month Membership',
  'membership.renewMembership': 'Renew Membership',
  'membership.ctaSeeStaffPurchase': 'Please see the employee to purchase membership.',
  'membership.ctaSeeStaffRenew': 'Please see the employee to renew membership.',
  'membership.pending': 'Pending',
  'membership.modal.title': 'Membership',
  'membership.modal.body.purchase':
    'Save on daily membership fees with a 6-month membership. Ask the employee about current 6-month membership pricing.',
  'membership.modal.body.renew':
    'Save on daily membership fees with a 6-month membership. Ask the employee about current 6-month membership renewal pricing.',
  'common.continue': 'Continue',

  // Purchase cards (Selection)
  'membership.pleaseSelectOne': 'Please select one',
  'membership.oneTimeOption': 'One-time Membership',
  'membership.sixMonthOption': '6-Month Membership',
  'membership.thankYouMember': 'Thank you for being a member.',
  'membership.expiresOn': 'Your membership expires on {date}.',
  'rental.title': 'Rental',

  // Experience section
  'experience.choose': 'Choose your experience:',

  // Availability
  limitedAvailability: 'Limited: only {count} left',
  unavailable: 'Currently unavailable - Tap to join waitlist',
  'availability.onlyAvailable': 'Only {count} available',
  'availability.unavailable': 'Unavailable',
  'availability.joinWaitlist': 'Join the waiting list',

  // Rental types (display)
  locker: 'Locker',
  regularRoom: 'Regular Room',
  doubleRoom: 'Double Room',
  specialRoom: 'Special Room',
  gymLocker: 'Gym Locker',
  'rental.standardDisplay': 'Private Dressing Room',
  'rental.doubleDisplay': 'Double Dressing Room',
  'rental.specialDisplay': 'Special Dressing Room',

  // Waitlist
  'waitlist.modalTitle': 'None Available - Join Waiting List?',
  'waitlist.currentlyUnavailable': '{rental} is currently unavailable.',
  'waitlist.infoTitle': 'Waitlist Information:',
  'waitlist.position': 'Position',
  'waitlist.estimatedReady': 'Estimated Ready',
  'waitlist.unknown': 'Unknown',
  'waitlist.upgradeFee': 'Upgrade Fee',
  'waitlist.instructions':
    'To join the waitlist, please select a backup rental that is available now.',
  'waitlist.noteChargedBackup':
    'You will be charged for the backup rental. If an upgrade becomes available, you may accept it (upgrade fees apply).',
  'waitlist.selectBackup': 'Select backup rental:',
  'waitlist.unavailableSuffix': '(Unavailable)',

  // Upgrade disclaimer
  'upgrade.title': 'Upgrade Disclaimer',
  'upgrade.bullet.feesApplyToRemaining':
    'Upgrade fees apply only to remaining time in your current stay.',
  'upgrade.bullet.noExtension':
    'Upgrades do not extend your stay. Your checkout time remains the same.',
  'upgrade.bullet.noRefunds': 'No refunds under any circumstances.',
  'upgrade.bullet.chargedWhenAccepted':
    'Upgrade fees are charged only when an upgrade becomes available and you choose to accept it.',

  // Staff selection confirmation
  'confirmDifferent.title': 'Staff Selected Different Option',
  'confirmDifferent.youRequested': 'You requested:',
  'confirmDifferent.staffSelected': 'Staff selected:',
  'confirmDifferent.question': 'Do you accept this selection?',

  // Renewal disclaimer
  'renewal.title': 'Renewal Notice',
  'renewal.bullet.extendsStay':
    'This renewal extends your stay for 6 hours from your current checkout time.',
  'renewal.currentCheckout': '(Current checkout: {time})',
  'renewal.bullet.approachingMax':
    '⚠️ You are approaching the 14-hour maximum stay for a single visit.',
  'renewal.bullet.finalExtension':
    'At the end of this 6-hour renewal, you may extend one final time for 2 additional hours (fee applies).',
  'renewal.bullet.feeNotChargedNow':
    'The fee is not charged now; it applies only if you choose the final 2-hour extension later.',

  // Errors (customer-friendly, generic)
  'error.loadAgreement': 'Failed to load agreement. Please try again.',
  'error.noActiveSession': 'No active session. Please wait for staff to start a session.',
  'error.processSelection': 'Failed to process selection. Please try again.',
  'error.process': 'Failed to process. Please try again.',
  'error.rentalNotAvailable':
    'This rental type is not available. Please select an available option.',
  'error.signAgreement': 'Failed to sign agreement. Please try again.',
  'error.setLanguage': 'Failed to set language. Please try again.',
  'error.confirmSelection': 'Failed to confirm selection. Please try again.',

  // Payment line item descriptions (client-side mapping for kiosk display)
  'lineItem.locker': 'Locker',
  'lineItem.gymLocker': 'Gym Locker',
  'lineItem.gymLockerNoCost': 'Gym Locker (no cost)',
  'lineItem.standardRoom': 'Standard Room',
  'lineItem.doubleRoom': 'Double Room',
  'lineItem.specialRoom': 'Special Room',
  'lineItem.membershipFee': 'Membership Fee',
  'lineItem.sixMonthMembership': '6 Month Membership',

  // General
  membership: 'Membership',
  noOptionsAvailable: 'No options available',
} as const;
