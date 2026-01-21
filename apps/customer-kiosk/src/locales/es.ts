// Customer Kiosk locale (Spanish)
//
// Keep keys aligned with `en.ts`. If a key is missing here at runtime, the app will fall back to EN.
import { en } from './en';
import { AGREEMENT_LEGAL_BODY_HTML_BY_LANG } from '@club-ops/shared';

export const es: Record<keyof typeof en, string> = {
  // Brand / a11y
  'brand.clubName': 'Club Dallas',
  'a11y.welcomeDialog': 'Bienvenido',
  'a11y.signatureDialog': 'Firma',

  // Welcome
  welcome: 'Bienvenido',
  'selection.welcomeWithName': 'Bienvenido, {name}',

  // Language selection
  selectLanguage: 'Elige idioma / Select Language',
  english: 'English',
  spanish: 'Español',

  // Orientation
  'orientation.title': 'Pon la pantalla vertical',
  'orientation.body': 'Gira la pantalla para seguir.',

  // Common
  'common.ok': 'OK',
  'common.cancel': 'Cancelar',
  'common.accept': 'Aceptar',
  'common.decline': 'No acepto',
  'common.you': 'Tú',
  'common.staff': 'Staff',
  'kiosk.locked.title': 'Ve con el empleado',
  'kiosk.locked.body':
    'Este carril sigue en proceso. Ve con el empleado para terminar.',

  // Past due
  pastDueBlocked: 'Pasa a caja para arreglar tu saldo.',

  // Payment
  paymentPending: 'Paga con el empleado',
  'payment.charges': 'Cargos',
  totalDue: 'Total',
  paymentIssueSeeAttendant: 'Problema con el pago — ve con el empleado',

  // Agreement
  agreementTitle: 'Acuerdo del Club',
  agreementPlaceholder: 'Aquí va el acuerdo.',
  scrollRequired: 'Desliza hasta el final para seguir.',
  iAgree: 'Acepto',
  signatureRequired: 'Firma para continuar',
  'agreement.readAndScrollToContinue': 'Lee el acuerdo y baja hasta el final para continuar…',
  'agreement.pleaseCheckToContinue': 'Marca la casilla para continuar',
  'agreement.tapToSign': 'Toca para firmar',
  'agreement.signed': 'Firmado',
  'agreement.sign': 'Firmar',
  'agreement.legalBodyHtml': AGREEMENT_LEGAL_BODY_HTML_BY_LANG.ES,
  clear: 'Limpiar',
  submit: 'Enviar',
  submitting: 'Enviando…',

  // Assignment / completion
  thankYou: '¡Gracias!',
  assignmentComplete: 'Estamos procesando tu entrada…',
  room: 'Cuarto',
  checkoutAt: 'Hora de salida',

  // Selection state
  proposed: 'Propuesto',
  selected: 'Seleccionado',
  confirmSelection: 'Confirmar',
  confirming: 'Confirmando...',
  acknowledge: 'Entendido',
  acknowledging: 'Entendido…',
  staffHasLocked: 'El staff ya bloqueó esta opción. Toca Entendido para seguir.',
  'selection.staffSuggestionHint': 'Sugerencia del staff — toca la opción marcada para aceptar',
  'selection.yourSelectionWaiting': 'Tu elección — esperando confirmación del staff',
  'guidance.pleaseSelectOne': 'Elige una opción',
  'selection.pendingApproval': 'Esperando approbación',

  // Membership section
  'membership.level': 'Nivel de membresía:',
  'membership.member': 'Miembro',
  'membership.nonMember': 'Sin membresía',
  'membership.expired': 'Vencida',
  'membership.purchase6Month': 'Membresía 6 meses',
  'membership.renewMembership': 'Renovar membresía',
  'membership.ctaSeeStaffPurchase': 'Pasa con el empleado para comprarla.',
  'membership.ctaSeeStaffRenew': 'Pasa con el empleado para renovarla.',
  'membership.pending': 'En proceso',
  'membership.modal.title': 'Membresía',
  'membership.modal.body.purchase':
    'Ahorra en la membresía por día con la membresía de 6 meses. Pregunta al empleado el precio actual de la membresía de 6 meses.',
  'membership.modal.body.renew':
    'Ahorra en la membresía por día con la renovación de 6 meses. Pregunta al empleado el precio actual de la renovación de 6 meses.',
  'common.continue': 'Continuar',

  // Purchase cards (Selection)
  'membership.pleaseSelectOne': 'Elige una',
  'membership.oneTimeOption': 'Membresía por día',
  'membership.sixMonthOption': 'Membresía 6 meses',
  'membership.thankYouMember': 'Gracias por ser miembro.',
  'membership.expiresOn': 'Vence el {date}.',
  'rental.title': 'Renta',

  // Experience section
  'experience.choose': 'Elige tu opción:',

  // Availability
  limitedAvailability: 'Quedan {count}',
  unavailable: 'No hay por ahora — toca para lista de espera',
  'availability.onlyAvailable': 'Solo {count} disponibles',
  'availability.unavailable': 'No disponible',
  'availability.joinWaitlist': 'Únete a la lista de espera',

  // Rental types (display)
  locker: 'Casillero',
  regularRoom: 'Habitación Regular',
  doubleRoom: 'Habitación Doble',
  specialRoom: 'Habitación Especial',
  gymLocker: 'Casillero del Gimnasio',
  'rental.standardDisplay': 'Vestidor privado',
  'rental.doubleDisplay': 'Vestidor deluxe',
  'rental.specialDisplay': 'Vestidor especial',

  // Waitlist
  'waitlist.modalTitle': 'No hay — ¿lista de espera?',
  'waitlist.currentlyUnavailable': 'No hay {rental} ahorita.',
  'waitlist.infoTitle': 'Datos de la lista:',
  'waitlist.position': 'Lugar',
  'waitlist.estimatedReady': 'Aprox. listo',
  'waitlist.unknown': 'Sin dato',
  'waitlist.upgradeFee': 'Costo de mejora',
  'waitlist.instructions':
    'Para anotarte, elige una opción de respaldo disponible.',
  'waitlist.noteChargedBackup':
    'Se cobra el respaldo. Si sale una mejora, puedes aceptarla (aplica costo).',
  'waitlist.selectBackup': 'Elige respaldo:',
  'waitlist.unavailableSuffix': '(No hay)',

  // Upgrade disclaimer
  'upgrade.title': 'Aviso de mejora',
  'upgrade.bullet.feesApplyToRemaining':
    'Las tarifas de mejora se aplican solo al tiempo restante de su estadía actual.',
  'upgrade.bullet.noExtension':
    'Las mejoras no extienden su estadía. Su hora de salida permanece igual.',
  'upgrade.bullet.noRefunds': 'No hay reembolsos bajo ninguna circunstancia.',
  'upgrade.bullet.chargedWhenAccepted':
    'Las tarifas de mejora se cobran solo cuando una mejora queda disponible y usted elige aceptarla.',

  // Staff selection confirmation
  'confirmDifferent.title': 'El personal seleccionó una opción diferente',
  'confirmDifferent.youRequested': 'Usted solicitó:',
  'confirmDifferent.staffSelected': 'El personal seleccionó:',
  'confirmDifferent.question': '¿Acepta esta selección?',

  // Renewal disclaimer
  'renewal.title': 'Aviso de renovación',
  'renewal.bullet.extendsStay':
    'Esta renovación extiende su estadía por 6 horas desde su hora de salida actual.',
  'renewal.currentCheckout': '(Salida actual: {time})',
  'renewal.bullet.approachingMax':
    '⚠️ Se está acercando al máximo de 14 horas de estadía para una sola visita.',
  'renewal.bullet.finalExtension':
    'Al final de esta renovación de 6 horas, puede extender una última vez por 2 horas adicionales (aplica tarifa).',
  'renewal.bullet.feeNotChargedNow':
    'La tarifa no se cobra ahora; solo aplica si elige la extensión final de 2 horas más adelante.',

  // Errors
  'error.loadAgreement': 'No se pudo cargar el acuerdo. Intenta de nuevo.',
  'error.noActiveSession':
    'No hay sesión activa. Espera a que el staff inicie una sesión.',
  'error.processSelection': 'No se pudo procesar. Intenta de nuevo.',
  'error.process': 'No se pudo procesar. Intenta de nuevo.',
  'error.rentalNotAvailable':
    'No está disponible. Elige una opción disponible.',
  'error.signAgreement': 'No se pudo firmar. Intenta de nuevo.',
  'error.setLanguage': 'No se pudo cambiar el idioma. Intenta de nuevo.',
  'error.confirmSelection': 'No se pudo confirmar. Intenta de nuevo.',

  // Payment line item descriptions (client-side mapping)
  'lineItem.locker': 'Casillero',
  'lineItem.gymLocker': 'Casillero del Gimnasio',
  'lineItem.gymLockerNoCost': 'Casillero del Gimnasio (sin costo)',
  'lineItem.standardRoom': 'Habitación Estándar',
  'lineItem.doubleRoom': 'Habitación Doble',
  'lineItem.specialRoom': 'Habitación Especial',
  'lineItem.membershipFee': 'Tarifa de membresía',
  'lineItem.sixMonthMembership': 'Membresía de 6 meses',

  // General
  membership: 'Membresía',
  noOptionsAvailable: 'No hay opciones disponibles',
};


