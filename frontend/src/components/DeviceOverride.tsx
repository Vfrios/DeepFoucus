import { useDevice } from '../device/useDevice';

/** Alterna manualmente entre os shells (equivale a ?view=mobile|web) e persiste. */
export default function DeviceOverride() {
  const { view, device, serverDevice, setView, clearOverride } = useDevice();
  return (
    <div className="override">
      <div className="seg" role="group" aria-label="Modo de exibição">
        <button className={view === 'mobile' ? 'on' : ''} onClick={() => setView('mobile')}>Celular</button>
        <button className={view === 'web' ? 'on' : ''} onClick={() => setView('web')}>Parede</button>
      </div>
      <button className="btn ghost" onClick={clearOverride}>Automático</button>
      <p className="hint">Detectado: {device}{serverDevice ? ` · servidor: ${serverDevice}` : ''}</p>
    </div>
  );
}

/** Banner discreto (aparece uma vez em tablets): "Usar modo parede (kiosk)?" */
export function KioskPrompt() {
  const { askKiosk, setView } = useDevice();
  if (!askKiosk) return null;
  return (
    <div className="kiosk-prompt" role="dialog" aria-label="Modo parede">
      <span>Usar modo parede (kiosk)?</span>
      <button className="btn" onClick={() => setView('web')}>Sim</button>
      <button className="btn ghost" onClick={() => setView('mobile')}>Não</button>
    </div>
  );
}
