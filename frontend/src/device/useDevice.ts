import { useContext } from 'react';
import { DeviceContext, DeviceCtx } from './DeviceProvider';

export function useDevice(): DeviceCtx {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error('useDevice fora do DeviceProvider');
  return ctx;
}
