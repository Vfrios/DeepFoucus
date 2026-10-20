import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { DeviceProvider } from './device/DeviceProvider';
import { captureTokenFromUrl } from './lib/api';
import './styles.css';

captureTokenFromUrl();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DeviceProvider>
      <App />
    </DeviceProvider>
  </StrictMode>
);

// Service Worker só em produção (em dev atrapalharia o HMR)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
