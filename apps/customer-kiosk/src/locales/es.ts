// Customer Kiosk locale (Spanish)
//
// Keep keys aligned with `en.ts`. If a key is missing here at runtime, the app will fall back to EN.
import { en } from './en';

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
  'agreement.legalBodyHtml': `<h2 style="text-align:center; margin: 0 0 12px 0;">EXENCIÓN DE RESPONSABILIDAD Y LIBERACIÓN DE RECLAMOS — CLUB DALLAS</h2>
<p style="text-align:center; margin: 0 0 18px 0; font-size: 12px;">Fecha de vigencia: Hoy</p>

<p><strong>LEA CUIDADOSAMENTE.</strong> Este Acuerdo contiene una liberación de responsabilidad y la renuncia a ciertos derechos legales. Al ingresar a Club Dallas (el “Club”), usted acepta los términos que se indican a continuación.</p>

<h3>1. Definiciones</h3>
<p>“Club Dallas”, “Club”, “nosotros”, “nos” y “nuestro” se refieren al/los operador(es), propietario(s), administradores, empleados, contratistas, agentes, afiliadas, sucesores y cesionarios de Club Dallas y de las instalaciones. “Invitado”, “usted” y “su” se refieren a la persona que ingresa a las instalaciones.</p>

<h3>2. Ingreso voluntario y asunción de riesgos</h3>
<p>Usted reconoce que visitar y utilizar las instalaciones implica riesgos inherentes, incluidos, entre otros, resbalones y caídas, reacciones alérgicas, exposición a productos de limpieza, interacciones con otros invitados y otros riesgos previsibles e imprevisibles. Usted asume voluntariamente todos los riesgos de lesión, enfermedad, daño a la propiedad y pérdida que se deriven de su ingreso y permanencia en las instalaciones, ya sea por negligencia ordinaria o de otra forma, en la máxima medida permitida por la ley aplicable.</p>

<h3>3. Liberación y renuncia de responsabilidad</h3>
<p>En la máxima medida permitida por la ley, por medio del presente usted libera, renuncia y exime al Club de toda reclamación, demanda, daño, pérdida, responsabilidad, costo y causa de acción de cualquier tipo que surja de o se relacione con su ingreso, permanencia o participación en cualquier actividad dentro de las instalaciones, incluyendo reclamaciones basadas en la negligencia ordinaria del Club.</p>

<h3>4. Indemnización</h3>
<p>Usted acepta indemnizar, defender y sacar en paz y a salvo al Club frente a cualquier reclamación, daño, responsabilidad y gasto (incluidos honorarios razonables de abogados) que surjan de o se relacionen con sus acciones, conducta, violaciones a las reglas del Club o incumplimiento de este Acuerdo.</p>

<h3>5. Conducta y cumplimiento</h3>
<p>Usted acepta cumplir con todas las reglas publicadas, instrucciones del personal y leyes aplicables. El Club se reserva el derecho de negar el acceso o retirar a cualquier invitado a su discreción. Usted reconoce que las violaciones a las reglas del Club pueden resultar en la expulsión sin reembolso y, cuando corresponda, podrán ser reportadas a las autoridades.</p>

<h3>6. Declaración de salud y aptitud</h3>
<p>Usted declara que se encuentra físicamente en condiciones de ingresar y utilizar las instalaciones y que no realizará conductas que representen un riesgo de daño para usted o para otras personas. Usted es responsable de sus pertenencias.</p>

<h3>7. Bienes personales; limitación de responsabilidad</h3>
<p>El Club no se hace responsable por bienes personales perdidos, robados o dañados, incluidos objetos de valor dejados en casilleros, cuartos o áreas comunes, salvo en los casos en que dicha responsabilidad no pueda excluirse por ley.</p>

<h3>8. Aviso de foto/video</h3>
<p>En la medida permitida por la ley, usted reconoce que puede existir monitoreo de seguridad en ciertas áreas por motivos de seguridad y cumplimiento. El Club no garantiza privacidad en áreas no privadas. (Nada en este documento autoriza grabaciones en áreas privadas.)</p>

<h3>9. Resolución de controversias</h3>
<p>Cualquier controversia derivada de este Acuerdo o de su ingreso al Club se resolverá en un foro legal con jurisdicción, conforme a la ley aplicable. Si alguna disposición se considera inaplicable, las demás permanecerán vigentes.</p>

<h3>10. Acuerdo total</h3>
<p>Este Acuerdo constituye el entendimiento total respecto al ingreso a las instalaciones y sustituye cualquier comunicación previa sobre este tema. Al firmar, usted reconoce que ha leído y entendido este Acuerdo y que acepta obligarse por sus términos.</p>

<p style="margin-top: 18px;"><strong>RECONOCIMIENTO:</strong> He leído este Acuerdo, lo entiendo y acepto sus términos.</p>`,
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
    'Ahorra en la cuota diaria comprando 6 meses por $43.',
  'membership.modal.body.renew':
    'Ahorra en la cuota diaria renovando 6 meses por $43.',
  'common.continue': 'Continuar',

  // Purchase cards (Selection)
  'membership.pleaseSelectOne': 'Elige una',
  'membership.oneTimeOption': 'Membresía por día - {price}',
  'membership.sixMonthOption': 'Membresía 6 meses - {price}',
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
    'Al final de esta renovación de 6 horas, puede extender una última vez por 2 horas adicionales por una tarifa fija de $20 (igual para casilleros o cualquier tipo de habitación).',
  'renewal.bullet.feeNotChargedNow':
    'La tarifa de $20 no se cobra ahora; solo aplica si elige la extensión final de 2 horas más adelante.',

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


