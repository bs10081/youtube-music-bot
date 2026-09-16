import { lazy, Suspense, type ReactNode } from 'react';
import { useMediaQuery } from './useMediaQuery';
const Refraction = lazy(() => import('./Refraction'));
export function GlassSurface({children, solid, className = ''}: {children: ReactNode; solid: boolean; className?: string}) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const reducedTransparency = useMediaQuery('(prefers-reduced-transparency: reduce)');
  const touch = useMediaQuery('(pointer: coarse)');
  const compact = useMediaQuery('(max-width: 767px)');
  const refract = !solid && !reduced && !reducedTransparency && !touch && !compact && /Chrome|Chromium|Edg\//.test(navigator.userAgent);
  return <div className={`listening-glass ${solid || reduced || reducedTransparency ? 'is-solid' : ''} ${className}`}>
    {refract ? <Suspense fallback={children}><Refraction>{children}</Refraction></Suspense> : children}
  </div>;
}
