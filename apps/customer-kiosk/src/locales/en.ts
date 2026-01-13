// Customer Kiosk locale (English)
//
// Add new UI strings here first, then add the same key to `es.ts`.
// Key convention:
// - `common.*` for shared/common UI
// - `a11y.*` for accessibility labels
// - `orientation.*`, `membership.*`, `selection.*`, `waitlist.*`, `upgrade.*`, `renewal.*`, `payment.*`
//
// Prefer sentence keys with simple `{param}` placeholders.
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
  'kiosk.locked.body': 'This lane is still being completed. Please see attendant to finish checkout.',

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
  'agreement.readAndScrollToContinue': 'Read the agreement, and scroll to the bottom to continue...',
  'agreement.pleaseCheckToContinue': 'Please check to continue',
  'agreement.tapToSign': 'Tap to Sign',
  'agreement.signed': 'Signed',
  'agreement.sign': 'Sign',
  'agreement.legalBodyHtml': `<h2 style="text-align:center; margin: 0 0 12px 0;">CLUB DALLAS ENTRY &amp; LIABILITY WAIVER</h2>
<p style="text-align:center; margin: 0 0 18px 0; font-size: 12px;">Effective Date: Today</p>

<p><strong>PLEASE READ CAREFULLY.</strong> This Agreement contains a release of liability and waiver of certain legal rights. By entering Club Dallas ("Club"), you agree to the terms below.</p>

<h3>1. Definitions</h3>
<p>"Club Dallas," "Club," "we," "us," and "our" mean the operator(s), owners, managers, employees, contractors, agents, affiliates, successors, and assigns of Club Dallas and the premises. "Guest," "you," and "your" mean the individual entering the premises.</p>

<h3>2. Voluntary Entry and Assumption of Risk</h3>
<p>You acknowledge that visiting and using the premises involves inherent risks, including but not limited to slips and falls, allergic reactions, exposure to cleaning products, interactions with other guests, and other foreseeable and unforeseeable hazards. You voluntarily assume all risks of injury, illness, property damage, and loss arising from your entry and presence on the premises, whether caused by ordinary negligence or otherwise, to the fullest extent permitted by law.</p>

<h3>3. Release and Waiver of Liability</h3>
<p>To the maximum extent permitted by law, you hereby release, waive, and discharge the Club from any and all claims, demands, damages, losses, liabilities, costs, and causes of action of any kind arising out of or related to your entry, presence, or participation in any activities on the premises, including claims based on the Club's ordinary negligence.</p>

<h3>4. Indemnification</h3>
<p>You agree to indemnify, defend, and hold harmless the Club from and against any claims, damages, liabilities, and expenses (including reasonable attorneys' fees) arising out of or related to your actions, conduct, violations of Club rules, or breach of this Agreement.</p>

<h3>5. Conduct and Compliance</h3>
<p>You agree to comply with all posted rules, staff instructions, and applicable laws. The Club reserves the right to refuse entry or remove any guest at its discretion. You acknowledge that violations of Club rules may result in removal without refund and may be reported to authorities where appropriate.</p>

<h3>6. Health and Fitness Acknowledgment</h3>
<p>You represent that you are physically able to enter and use the premises and that you will not engage in conduct that poses a risk of harm to yourself or others. You are responsible for your own personal property.</p>

<h3>7. Personal Property; Limitation of Responsibility</h3>
<p>The Club is not responsible for lost, stolen, or damaged personal property, including valuables left in lockers, rooms, or common areas, except where liability cannot be excluded by law.</p>

<h3>8. Photo/Video Notice</h3>
<p>To the extent permitted by law, you acknowledge that security monitoring may be in use in certain areas for safety and compliance. The Club does not guarantee privacy in any non-private area. (No statement here authorizes recording in private areas.)</p>

<h3>9. Dispute Resolution</h3>
<p>Any dispute arising out of this Agreement or your entry to the Club shall be resolved in a lawful forum with jurisdiction, under applicable law. If any provision is held unenforceable, the remainder remains in effect.</p>

<h3>10. Entire Agreement</h3>
<p>This Agreement represents the entire understanding regarding entry to the premises and supersedes prior communications on this subject. By signing below, you acknowledge that you have read and understood this Agreement and agree to be bound by it.</p>

<p style="margin-top: 18px;"><strong>ACKNOWLEDGMENT:</strong> I have read this Agreement, understand it, and agree to its terms.</p>`,
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
    'You can save on daily membership fees by purchasing a 6 month membership for $43.',
  'membership.modal.body.renew':
    'You can save on daily membership fees by renewing a 6 month membership for $43.',
  'common.continue': 'Continue',

  // Purchase cards (Selection)
  'membership.pleaseSelectOne': 'Please select one',
  'membership.oneTimeOption': 'One-time Membership - {price}',
  'membership.sixMonthOption': '6-Month Membership - {price}',
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

  // Rental types (display)
  locker: 'Locker',
  regularRoom: 'Regular Room',
  doubleRoom: 'Double Room',
  specialRoom: 'Special Room',
  gymLocker: 'Gym Locker',
  'rental.standardDisplay': 'Private Dressing Room',
  'rental.doubleDisplay': 'Deluxe Dressing Room',
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
  'upgrade.bullet.noExtension': 'Upgrades do not extend your stay. Your checkout time remains the same.',
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
    'At the end of this 6-hour renewal, you may extend one final time for 2 additional hours for a flat $20 fee (same for lockers or any room type).',
  'renewal.bullet.feeNotChargedNow':
    'The $20 fee is not charged now; it applies only if you choose the final 2-hour extension later.',

  // Errors (customer-friendly, generic)
  'error.loadAgreement': 'Failed to load agreement. Please try again.',
  'error.noActiveSession': 'No active session. Please wait for staff to start a session.',
  'error.processSelection': 'Failed to process selection. Please try again.',
  'error.process': 'Failed to process. Please try again.',
  'error.rentalNotAvailable': 'This rental type is not available. Please select an available option.',
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


