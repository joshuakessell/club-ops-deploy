// Customer Kiosk locale (Spanish)
//
// Keep keys aligned with `en.ts`. If a key is missing here at runtime, the app will fall back to EN.
import { en } from './en';

export const es: Record<keyof typeof en, string> = {
  // Brand / a11y
  'brand.clubName': 'Club Dallas',
  'a11y.welcomeDialog': 'Bienvenido',

  // Welcome
  welcome: 'Bienvenido',
  'selection.welcomeWithName': 'Bienvenido, {name}',

  // Language selection
  selectLanguage: 'Seleccione Idioma / Select Language',
  english: 'English',
  spanish: 'Español',

  // Orientation
  'orientation.title': 'Se requiere modo vertical',
  'orientation.body': 'Por favor, gire el dispositivo a vertical para continuar.',

  // Common
  'common.ok': 'OK',
  'common.cancel': 'Cancelar',
  'common.accept': 'Aceptar',
  'common.decline': 'Rechazar',
  'common.you': 'Usted',
  'common.staff': 'Personal',

  // Past due
  pastDueBlocked: 'Por favor, vea al mostrador para resolver su saldo.',

  // Payment
  paymentPending: 'Por favor, presente el pago al empleado',
  'payment.charges': 'Cargos',
  totalDue: 'Total a Pagar',
  paymentIssueSeeAttendant: 'Problema con el pago — por favor vea al empleado',

  // Agreement
  agreementTitle: 'Acuerdo del Club',
  agreementPlaceholder: 'El contenido del acuerdo se mostrará aquí.',
  scrollRequired: 'Por favor, desplácese hasta el final del acuerdo para continuar.',
  iAgree: 'Estoy de acuerdo',
  signatureRequired: 'Se requiere firma para continuar',
  clear: 'Limpiar',
  submit: 'Enviar',
  submitting: 'Enviando...',

  // Assignment / completion
  thankYou: '¡Gracias!',
  assignmentComplete: 'Su registro está siendo procesado...',
  room: 'Habitación',
  checkoutAt: 'Hora de Salida',

  // Selection state
  proposed: 'Propuesto',
  selected: 'Seleccionado',
  confirmSelection: 'Confirmar Selección',
  confirming: 'Confirmando...',
  acknowledge: 'Reconocer',
  acknowledging: 'Reconociendo...',
  staffHasLocked: 'El personal ha bloqueado esta selección. Por favor, reconozca para continuar.',
  'selection.staffSuggestionHint': 'Sugerencia del personal — toque la opción resaltada para aceptar',
  'selection.yourSelectionWaiting': 'Su selección — esperando confirmación del personal',

  // Membership section
  'membership.level': 'Nivel de membresía:',
  'membership.member': 'Miembro',
  'membership.nonMember': 'No miembro',
  'membership.expired': 'Vencida',
  'membership.purchase6Month': 'Comprar membresía de 6 meses',
  'membership.renewMembership': 'Renovar membresía',
  'membership.ctaSeeStaffPurchase': 'Por favor, vea al empleado para comprar la membresía.',
  'membership.ctaSeeStaffRenew': 'Por favor, vea al empleado para renovar la membresía.',
  'membership.pending': 'Pendiente',
  'membership.modal.title': 'Membresía',
  'membership.modal.body.purchase':
    'Puede ahorrar en las tarifas diarias de membresía comprando una membresía de 6 meses por $43.',
  'membership.modal.body.renew':
    'Puede ahorrar en las tarifas diarias de membresía renovando una membresía de 6 meses por $43.',
  'common.continue': 'Continuar',

  // Experience section
  'experience.choose': 'Elige tu experiencia:',

  // Availability
  limitedAvailability: 'Limitado: solo quedan {count}',
  unavailable: 'No disponible actualmente - Toque para unirse a la lista de espera',
  'availability.onlyAvailable': 'Solo {count} disponibles',
  'availability.unavailable': 'No disponible',

  // Rental types (display)
  locker: 'Casillero',
  regularRoom: 'Habitación Regular',
  doubleRoom: 'Habitación Doble',
  specialRoom: 'Habitación Especial',
  gymLocker: 'Casillero del Gimnasio',
  'rental.standardDisplay': 'Vestidor Privado',
  'rental.doubleDisplay': 'Vestidor Deluxe',
  'rental.specialDisplay': 'Vestidor Especial',

  // Waitlist
  'waitlist.joinUpgrade': 'Unirse a la lista de espera para mejora',
  'waitlist.modalTitle': 'No hay disponibilidad — ¿unirse a la lista de espera?',
  'waitlist.currentlyUnavailable': '{rental} no está disponible actualmente.',
  'waitlist.infoTitle': 'Información de la lista de espera:',
  'waitlist.position': 'Posición',
  'waitlist.estimatedReady': 'Listo estimado',
  'waitlist.unknown': 'Desconocido',
  'waitlist.upgradeFee': 'Tarifa de mejora',
  'waitlist.instructions':
    'Para unirse a la lista de espera, seleccione un alquiler de respaldo que esté disponible ahora.',
  'waitlist.noteChargedBackup':
    'Se le cobrará por el alquiler de respaldo. Si una mejora queda disponible, puede aceptarla (se aplican tarifas de mejora).',
  'waitlist.selectBackup': 'Seleccione alquiler de respaldo:',
  'waitlist.unavailableSuffix': '(No disponible)',

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
    'Al final de esta renovación de 6 horas, puede extender una última vez por 2 horas adicionales por una tarifa fija de $20 (igual para casilleros o cualquier tipo de habitación).',
  'renewal.bullet.feeNotChargedNow':
    'La tarifa de $20 no se cobra ahora; solo aplica si elige la extensión final de 2 horas más adelante.',

  // Errors
  'error.loadAgreement': 'No se pudo cargar el acuerdo. Por favor, intente de nuevo.',
  'error.noActiveSession':
    'No hay una sesión activa. Por favor, espere a que el personal inicie una sesión.',
  'error.processSelection': 'No se pudo procesar la selección. Por favor, intente de nuevo.',
  'error.process': 'No se pudo procesar. Por favor, intente de nuevo.',
  'error.rentalNotAvailable':
    'Este tipo de alquiler no está disponible. Por favor, seleccione una opción disponible.',
  'error.signAgreement': 'No se pudo firmar el acuerdo. Por favor, intente de nuevo.',
  'error.setLanguage': 'No se pudo establecer el idioma. Por favor, intente de nuevo.',
  'error.confirmSelection': 'No se pudo confirmar la selección. Por favor, intente de nuevo.',

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


