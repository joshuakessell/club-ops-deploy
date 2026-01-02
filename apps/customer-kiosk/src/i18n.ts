// Language dictionary for customer kiosk
export type Language = 'EN' | 'ES';

export const translations: Record<Language, Record<string, string>> = {
  EN: {
    // Language selection
    'selectLanguage': 'Select Language / Seleccione Idioma',
    'english': 'English',
    'spanish': 'Español',
    
    // Past due
    'pastDueBlocked': 'Please see the front desk to resolve your balance.',
    
    // Low availability
    'limitedAvailability': 'Limited: only {count} left',
    'unavailable': 'Currently unavailable - Tap to join waitlist',
    
    // Payment
    'paymentPending': 'Please present payment to the employee',
    'totalDue': 'Total Due',
    
    // Agreement
    'agreementTitle': 'Club Agreement',
    'agreementPlaceholder': 'Agreement content will be displayed here.',
    'scrollRequired': 'Please scroll to the bottom of the agreement to continue.',
    'iAgree': 'I agree',
    'signatureRequired': 'Signature required to continue',
    'clear': 'Clear',
    'submit': 'Submit',
    'submitting': 'Submitting...',
    
    // Assignment
    'thankYou': 'Thank you!',
    'assignmentComplete': 'Your check-in is being processed...',
    'room': 'Room',
    'checkoutAt': 'Checkout Time',
    
    // Selection
    'proposed': 'Proposed',
    'selected': 'Selected',
    'confirmSelection': 'Confirm Selection',
    'confirming': 'Confirming...',
    'acknowledge': 'Acknowledge',
    'acknowledging': 'Acknowledging...',
    'staffHasLocked': 'Staff has locked this selection. Please acknowledge to continue.',
    
    // Rental types
    'locker': 'Locker',
    'regularRoom': 'Regular Room',
    'doubleRoom': 'Double Room',
    'specialRoom': 'Special Room',
    'gymLocker': 'Gym Locker',
    
    // General
    'membership': 'Membership',
    'noOptionsAvailable': 'No options available',
  },
  ES: {
    // Language selection
    'selectLanguage': 'Seleccione Idioma / Select Language',
    'english': 'English',
    'spanish': 'Español',
    
    // Past due
    'pastDueBlocked': 'Por favor, vea al mostrador para resolver su saldo.',
    
    // Low availability
    'limitedAvailability': 'Limitado: solo quedan {count}',
    'unavailable': 'No disponible actualmente - Toque para unirse a la lista de espera',
    
    // Payment
    'paymentPending': 'Por favor, presente el pago al empleado',
    'totalDue': 'Total a Pagar',
    
    // Agreement
    'agreementTitle': 'Acuerdo del Club',
    'agreementPlaceholder': 'El contenido del acuerdo se mostrará aquí.',
    'scrollRequired': 'Por favor, desplácese hasta el final del acuerdo para continuar.',
    'iAgree': 'Estoy de acuerdo',
    'signatureRequired': 'Se requiere firma para continuar',
    'clear': 'Limpiar',
    'submit': 'Enviar',
    'submitting': 'Enviando...',
    
    // Assignment
    'thankYou': '¡Gracias!',
    'assignmentComplete': 'Su registro está siendo procesado...',
    'room': 'Habitación',
    'checkoutAt': 'Hora de Salida',
    
    // Selection
    'proposed': 'Propuesto',
    'selected': 'Seleccionado',
    'confirmSelection': 'Confirmar Selección',
    'confirming': 'Confirmando...',
    'acknowledge': 'Reconocer',
    'acknowledging': 'Reconociendo...',
    'staffHasLocked': 'El personal ha bloqueado esta selección. Por favor, reconozca para continuar.',
    
    // Rental types
    'locker': 'Casillero',
    'regularRoom': 'Habitación Regular',
    'doubleRoom': 'Habitación Doble',
    'specialRoom': 'Habitación Especial',
    'gymLocker': 'Casillero del Gimnasio',
    
    // General
    'membership': 'Membresía',
    'noOptionsAvailable': 'No hay opciones disponibles',
  },
};

export function t(lang: Language | null | undefined, key: string, params?: Record<string, string | number>): string {
  const language = lang || 'EN';
  let text = translations[language][key] || translations.EN[key] || key;
  
  if (params) {
    Object.entries(params).forEach(([paramKey, value]) => {
      text = text.replace(`{${paramKey}}`, String(value));
    });
  }
  
  return text;
}

