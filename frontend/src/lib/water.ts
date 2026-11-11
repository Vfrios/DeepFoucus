export const DAILY_WATER_GOAL_ML = 2000;
export const WATER_INTAKE_EVENT = 'wd:water-updated';

export function waterIntakeStorageKey(date = new Date()): string {
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `wd:water:${dateKey}`;
}

export function readWaterIntake(): number {
  try {
    const saved = localStorage.getItem(waterIntakeStorageKey());
    const amount = Number(saved);
    return Number.isFinite(amount) && amount >= 0 ? amount : 0;
  } catch (error) {
    console.error('Não foi possível ler o registro de hidratação.', error);
    return 0;
  }
}
