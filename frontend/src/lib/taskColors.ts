import type { Tipo } from '../hooks/useTasks';

export const DEFAULT_TASK_COLORS: Record<Tipo, string> = {
  tarefa: '#86d7c0',
  estudo: '#f0b95a',
  evento: '#9db4ff',
};

export const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

export const getDefaultTaskColor = (tipo: Tipo): string => DEFAULT_TASK_COLORS[tipo];

export function getTaskTextColor(color: string): string {
  const normalized = color.slice(1);
  const channels = [0, 2, 4].map((index) => parseInt(normalized.slice(index, index + 2), 16) / 255);
  const luminance = channels
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  return luminance > 0.42 ? '#11161d' : '#ece6da';
}

export function getTaskTintColor(color: string): string {
  const hex = color.slice(1);
  const channels = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return `rgba(${channels.join(', ')}, 0.22)`;
}
