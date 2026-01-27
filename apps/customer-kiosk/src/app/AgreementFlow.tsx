import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
  type ReactNode,
  type SetStateAction,
  type TouchEvent,
} from 'react';
import { getErrorMessage, readJson } from '@club-ops/ui';
import { t } from '../i18n';
import { AgreementScreen, type Agreement } from '../screens/AgreementScreen';
import type { SessionState } from '../utils/membership';

interface AgreementFlowProps {
  apiBase: string;
  kioskAuthHeaders: (extra?: Record<string, string>) => Record<string, string>;
  session: SessionState;
  lane: string | null;
  checkinMode: 'CHECKIN' | 'RENEWAL' | null;
  orientationOverlay: ReactNode;
  welcomeOverlay: ReactNode;
  isSubmitting: boolean;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
}

type SignatureEvent =
  | MouseEvent<HTMLCanvasElement>
  | TouchEvent<HTMLCanvasElement>;

export function AgreementFlow({
  apiBase,
  kioskAuthHeaders,
  session,
  lane,
  checkinMode,
  orientationOverlay,
  welcomeOverlay,
  isSubmitting,
  setIsSubmitting,
}: AgreementFlowProps) {
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [hasScrolledAgreement, setHasScrolledAgreement] = useState(false);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const agreementScrollRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);

  useEffect(() => {
    setAgreed(false);
    setSignatureData(null);
    setHasScrolledAgreement(false);
  }, [session.sessionId]);

  useEffect(() => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [session.sessionId]);

  useEffect(() => {
    const scrollArea = agreementScrollRef.current;
    if (!scrollArea) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollArea;
      if (scrollTop + clientHeight >= scrollHeight - 10) {
        setHasScrolledAgreement(true);
      }
    };
    scrollArea.addEventListener('scroll', handleScroll);
    return () => scrollArea.removeEventListener('scroll', handleScroll);
  }, [session.sessionId]);

  useEffect(() => {
    if (!session.sessionId) return;
    const lang = session.customerPrimaryLanguage;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${apiBase}/v1/agreements/active`);
        if (!response.ok) {
          const errorPayload = await readJson(response);
          throw new Error(getErrorMessage(errorPayload) || 'Failed to load agreement');
        }
        const data = (await response.json()) as Agreement;
        if (cancelled) return;
        setAgreement({
          id: data.id,
          version: data.version,
          title: lang === 'ES' ? t(lang, 'agreementTitle') : data.title,
          bodyText: lang === 'ES' ? t(lang, 'agreement.legalBodyHtml') : data.bodyText,
        });
      } catch (error) {
        console.error('Failed to load agreement:', error);
        alert(t(lang, 'error.loadAgreement'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, session.customerPrimaryLanguage, session.sessionId]);

  const handleSignatureStart = (e: SignatureEvent) => {
    isDrawingRef.current = true;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0]?.clientY : e.clientY;
    if (clientX == null || clientY == null) return;
    if ('touches' in e) e.preventDefault();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handleSignatureMove = (e: SignatureEvent) => {
    if (!isDrawingRef.current) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0]?.clientY : e.clientY;
    if (clientX == null || clientY == null) return;
    if ('touches' in e) e.preventDefault();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handleSignatureEnd = () => {
    isDrawingRef.current = false;
    const canvas = signatureCanvasRef.current;
    if (canvas) {
      setSignatureData(canvas.toDataURL('image/png'));
    }
  };

  const handleClearSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#000000';
    }
    setSignatureData(null);
  };

  const handleSubmitAgreement = async () => {
    if (!agreed || !signatureData || !session.sessionId || !hasScrolledAgreement) {
      const lang = session.customerPrimaryLanguage;
      alert(t(lang, 'signatureRequired'));
      return;
    }
    if (!lane) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBase}/v1/checkin/lane/${lane}/sign-agreement`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...kioskAuthHeaders(),
        },
        body: JSON.stringify({
          signaturePayload: signatureData,
          sessionId: session.sessionId || undefined,
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to sign agreement');
      }
    } catch (error) {
      console.error('Failed to sign agreement:', error);
      alert(t(session.customerPrimaryLanguage, 'error.signAgreement'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (checkinMode !== 'CHECKIN' && checkinMode !== 'RENEWAL') {
    return null;
  }

  return (
    <AgreementScreen
      customerPrimaryLanguage={session.customerPrimaryLanguage}
      agreement={agreement}
      agreed={agreed}
      signatureData={signatureData}
      hasScrolledAgreement={hasScrolledAgreement}
      isSubmitting={isSubmitting}
      orientationOverlay={orientationOverlay}
      welcomeOverlay={welcomeOverlay}
      agreementScrollRef={agreementScrollRef}
      signatureCanvasRef={signatureCanvasRef}
      onAgreeChange={setAgreed}
      onSignatureStart={handleSignatureStart}
      onSignatureMove={handleSignatureMove}
      onSignatureEnd={handleSignatureEnd}
      onClearSignature={handleClearSignature}
      onSubmit={() => void handleSubmitAgreement()}
    />
  );
}
