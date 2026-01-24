type FatalEnvScreenProps = {
  message: string;
};

export function FatalEnvScreen({ message }: FatalEnvScreenProps) {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 720 }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Fatal configuration error</h1>
      <p style={{ marginTop: 12, lineHeight: 1.5 }}>{message}</p>
      <pre
        style={{ marginTop: 12, padding: 12, background: '#111', color: '#fff', borderRadius: 8 }}
      >
        {'Required: VITE_KIOSK_TOKEN\nFix: set it in your .env / env vars and restart dev server.'}
      </pre>
    </div>
  );
}
