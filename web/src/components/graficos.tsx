import type { ReactNode } from 'react';
import { cx } from './ui';

/** Tooltip común de los gráficos, con los colores del tema. */
export function CajaTooltip({ active, payload, label, titulo, filas }: any & { titulo?: (l: any) => ReactNode; filas: (p: any) => [string, ReactNode][] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-linea bg-panel px-3 py-2 text-[13px] shadow-panel">
      <p className="mb-1 font-medium">{titulo ? titulo(label) : label}</p>
      {filas(payload[0].payload).map(([k, v]: [string, ReactNode]) => (
        <p key={k} className="flex justify-between gap-6 text-tenue"><span>{k}</span><span className="cifra text-tinta">{v}</span></p>
      ))}
    </div>
  );
}

/** Barra horizontal proporcional (0..1) para rankings dentro de tablas y listas. */
export function Barra({ valor, tono = 'marca', className }: { valor: number; tono?: 'marca' | 'verde' | 'ambar' | 'rojo'; className?: string }) {
  const color = { marca: 'bg-marca', verde: 'bg-verde', ambar: 'bg-ambar', rojo: 'bg-rojo' }[tono];
  return (
    <div className={cx('h-1.5 overflow-hidden rounded-full bg-linea/70', className)} aria-hidden>
      <div className={cx('h-full rounded-full', color)} style={{ width: `${Math.max(0, Math.min(1, valor)) * 100}%` }} />
    </div>
  );
}

export const tonoPuntuacion = (p: number | null) => (p === null ? 'marca' : p >= 85 ? 'verde' : p >= 70 ? 'ambar' : 'rojo') as 'marca' | 'verde' | 'ambar' | 'rojo';
export const tonoOtd = (v: number | null) => (v === null ? 'marca' : v >= 0.85 ? 'verde' : v >= 0.7 ? 'ambar' : 'rojo') as 'marca' | 'verde' | 'ambar' | 'rojo';
export const claseTono = { marca: 'text-tinta', verde: 'text-verde', ambar: 'text-ambar', rojo: 'text-rojo' } as const;
