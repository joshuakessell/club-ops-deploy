type FatalEnvScreenProps = {
  message: string;
};

export function FatalEnvScreen({ message }: FatalEnvScreenProps) {
  return (
    <div className="u-font-sans u-p-24 u-max-w-720">
      <h1 className="u-mt-0 u-text-22">Fatal configuration error</h1>
      <p className="u-mt-12 u-leading-relaxed">{message}</p>
      <pre className="u-mt-12 u-p-12 u-bg-ink u-text-white u-radius-8">
        {'Required: VITE_KIOSK_TOKEN\nFix: set it in your .env / env vars and restart dev server.'}
      </pre>
    </div>
  );
}
