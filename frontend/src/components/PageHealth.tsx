import { useState } from 'react';
import { DAILY_WATER_GOAL_ML, readWaterIntake, WATER_INTAKE_EVENT, waterIntakeStorageKey } from '../lib/water';

const INTAKE_ML = 250;

export default function PageHealth() {
  const [intake, setIntake] = useState(readWaterIntake);
  const [error, setError] = useState('');
  const progress = Math.min(intake / DAILY_WATER_GOAL_ML, 1);

  const addWater = () => {
    const next = intake + INTAKE_ML;
    try {
      localStorage.setItem(waterIntakeStorageKey(), String(next));
      setIntake(next);
      window.dispatchEvent(new Event(WATER_INTAKE_EVENT));
      setError('');
    } catch {
      setError('Não foi possível salvar o registro neste dispositivo.');
    }
  };

  return (
    <main className="page health-page">
      <p className="calendar-eyebrow">BEM-ESTAR</p>
      <h1 className="page-title">Água e Saúde</h1>
      <section className="water-card" aria-labelledby="water-title">
        <div className="water-card-heading">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <path d="M7 3h10l-1 17H8L7 3Z" />
            <path d="M8 13h8" />
          </svg>
          <div>
            <h2 id="water-title">Hidratação de hoje</h2>
            <p>Meta diária: {(DAILY_WATER_GOAL_ML / 1000).toLocaleString('pt-BR')} L</p>
          </div>
        </div>
        <progress value={progress} max={1} aria-label={`${Math.round(progress * 100)}% da meta diária`} />
        <p className="water-total">
          {(intake / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} L
          <span> registrados hoje</span>
        </p>
        <button className="btn" type="button" onClick={addWater}>
          Registrar 250 ml
        </button>
        {error && <p className="notice" role="alert">{error}</p>}
      </section>
    </main>
  );
}
