import { PanelContent } from './views/PanelContent';
import { PanelHeader } from './views/PanelHeader';
import { PanelShell } from './views/PanelShell';

export function MessagesView() {
  return (
    <PanelShell>
      <PanelHeader title="Messages (stub)" />
      <PanelContent>
        <div className="placeholder">
          <span className="placeholder-icon">💬</span>
          <p>
            Messaging is a stub in this demo. (Planned: staff broadcast + manager announcements.)
          </p>
        </div>
      </PanelContent>
    </PanelShell>
  );
}
