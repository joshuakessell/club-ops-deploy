import { useEffect } from 'react';

export function usePulseHighlightStyles() {
  useEffect(() => {
    const styleId = 'pulse-bright-keyframes';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.innerHTML = `
        @keyframes pulse-bright {
          0% { box-shadow: 0 0 0 0 rgba(255,255,255,0.35); }
          50% { box-shadow: 0 0 0 12px rgba(255,255,255,0); }
          100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); }
        }
        .pulse-bright {
          animation: pulse-bright 1s ease-in-out infinite;
        }
      `;
      document.head.appendChild(style);
    }
  }, []);
}
