import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { DeviceProvider } from './device/DeviceProvider';
import { captureJwtFromUrl } from './lib/api';
import './styles.css';

const loginResult = captureJwtFromUrl();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DeviceProvider>
      <App loginResult={loginResult} />
    </DeviceProvider>
  </StrictMode>
);

// Service Worker só em produção (em dev atrapalharia o HMR)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
