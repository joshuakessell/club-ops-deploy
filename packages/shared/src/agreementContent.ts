export type AgreementLanguage = 'EN' | 'ES';

/**
 * Canonical agreement HTML as rendered in the customer kiosk (via `dangerouslySetInnerHTML`).
 *
 * IMPORTANT:
 * - Keep this as the single source of truth for any hard-coded “built-in” agreement text.
 * - The backend may still store/serve an agreement from the database; however, when the kiosk
 *   shows a built-in Spanish agreement, the PDF generator must use the exact same wording.
 */
export const AGREEMENT_LEGAL_BODY_HTML_BY_LANG: Record<AgreementLanguage, string> = {
  EN: `<h2 style="text-align:center; margin: 0 0 12px 0;">CLUB DALLAS ENTRY &amp; LIABILITY WAIVER</h2>
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
  ES: `<h2 style="text-align:center; margin: 0 0 12px 0;">EXENCIÓN DE RESPONSABILIDAD Y LIBERACIÓN DE RECLAMOS — CLUB DALLAS</h2>
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
};

