import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@club-ops/ui/styles/index.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
