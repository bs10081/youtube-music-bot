import LiquidGlass from 'liquid-glass-react';
import type { ReactNode } from 'react';
export default function Refraction({children}: {children: ReactNode}) {
  return <LiquidGlass style={{position:'absolute',top:'50%',left:'50%',width:'100%',height:'100%'}} className="listening-lens" padding="0" cornerRadius={28} displacementScale={12} blurAmount={0.04} saturation={120} aberrationIntensity={0} elasticity={0}>{children}</LiquidGlass>;
}
