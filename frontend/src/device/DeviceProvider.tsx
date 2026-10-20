import { createContext, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { detectDevice, Device } from './detect';

export type View = 'mobile' | 'web';
const VIEW_KEY = 'wd:view';

export interface DeviceCtx {
  device: Device;            // detecção bruta
  view: View;                // shell que será renderizado
  askKiosk: boolean;         // mostrar banner "Usar modo parede?"
  serverDevice: string | null; // o que o servidor (UA/Client Hints) achou — só informativo
  setView: (v: View) => void;
  clearOverride: () => void;
}

export const DeviceContext = createContext<DeviceCtx | null>(null);

/**
 * REGRA DE DECISÃO
 * 1. ?view=mobile|web na URL => override, persistido em localStorage (?view=auto limpa).
 * 2. Senão, escolha salva anteriormente.
 * 3. Senão, detecção client-side. Tablet é ambíguo: abre como parede, mas pergunta uma vez.
 */
function decide(): { view: View; ask: boolean; device: Device } {
  const device = detectDevice();
  const q = new URLSearchParams(location.search).get('view');
  if (q === 'auto') localStorage.removeItem(VIEW_KEY);
  else if (q === 'mobile' || q === 'web') {
    localStorage.setItem(VIEW_KEY, q);
    return { view: q, ask: false, device };
  }
  const saved = localStorage.getItem(VIEW_KEY);
  if (saved === 'mobile' || saved === 'web') return { view: saved, ask: false, device };
  if (device === 'mobile') return { view: 'mobile', ask: false, device };
  if (device === 'tablet') return { view: 'web', ask: true, device };
  return { view: 'web', ask: false, device };
}

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(decide);
  const [serverDevice, setServerDevice] = useState<string | null>(null);

  // Confirmação com o servidor (informativa; o cliente decide)
  useEffect(() => {
    fetch('/api/device')
      .then((r) => r.json())
      .then((d) => setServerDevice(d.device))
      .catch(() => undefined);
  }, []);

  const setView = useCallback((v: View) => {
    localStorage.setItem(VIEW_KEY, v);
    setState((s) => ({ ...s, view: v, ask: false }));
  }, []);

  const clearOverride = useCallback(() => {
    localStorage.removeItem(VIEW_KEY);
    setState(decide());
  }, []);

  const value = useMemo<DeviceCtx>(
    () => ({ device: state.device, view: state.view, askKiosk: state.ask, serverDevice, setView, clearOverride }),
    [state, serverDevice, setView, clearOverride]
  );
  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}
