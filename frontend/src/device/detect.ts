export type Device = 'mobile' | 'tablet' | 'desktop';

/**
 * DETECÇÃO CLIENT-SIDE (mais confiável que UA: iPadOS finge ser Mac, "site para desktop" etc.)
 * Combina: Client Hints (userAgentData), pointer/hover, maxTouchPoints e tamanho de tela.
 */
export function detectDevice(): Device {
  const uaData = (navigator as any).userAgentData as { mobile?: boolean } | undefined;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const hoverNone = matchMedia('(hover: none)').matches;
  const touch = navigator.maxTouchPoints > 0;
  const w = window.innerWidth;
  // lado menor da tela física: não muda ao girar o aparelho (celular deitado continua "celular")
  const shortSide = Math.min(screen.width, screen.height);

  const phone = (coarse || touch) && shortSide < 600;
  if (w < 768 || phone || (uaData?.mobile === true && shortSide < 768)) return 'mobile';

  // 768–1366 + toque => tablet (ex.: tablet fixo na parede)
  if ((coarse || hoverNone) && touch && w <= 1366) return 'tablet';

  return 'desktop';
}
