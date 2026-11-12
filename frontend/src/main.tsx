import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './AuthContext';
import { DeviceProvider } from './device/DeviceProvider';
import { captureJwtFromUrl } from './lib/api';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import './styles.css';

const loginResult = captureJwtFromUrl();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DeviceProvider>
      <AuthProvider>
        <App loginResult={loginResult} />
      </AuthProvider>
    </DeviceProvider>
  </StrictMode>
);

// Service Worker só em produção (em dev atrapalharia o HMR)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => registration.update())
      .catch(() => undefined);
  });
}
