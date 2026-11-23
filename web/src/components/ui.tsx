import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, RotateCw, X } from 'lucide-react';
import {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import type { ErrorApi } from '../lib/api';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------- Botón ----------
type Variante = 'primario' | 'secundario' | 'fantasma' | 'peligro';
const VARIANTES: Record<Variante, string> = {
  primario: 'bg-marca text-sobre-marca hover:bg-marca-fuerte border-transparent',
  secundario: 'bg-panel text-tinta border-linea hover:bg-panel2',
  fantasma: 'bg-transparent text-tenue border-transparent hover:bg-panel2 hover:text-tinta',
  peligro: 'bg-panel text-rojo border-linea hover:bg-rojo-suave',
};
export function Boton({ variante = 'secundario', cargando, pequeno, className, children, disabled, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; cargando?: boolean; pequeno?: boolean }) {
  return (
    <button type="button" {...p} disabled={disabled || cargando}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-md border font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        pequeno ? 'h-7 px-2 text-[13px]' : 'h-9 px-3.5', VARIANTES[variante], className)}>
      {cargando && <Loader2 size={15} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

// ---------- Campos ----------
const CONTROL = 'w-full h-9 rounded-md border border-linea bg-panel px-2.5 text-tinta placeholder:text-tenue/70 transition-colors hover:border-tenue/60 focus:border-marca focus:outline-none focus:ring-2 focus:ring-marca/25 disabled:opacity-60 aria-[invalid=true]:border-rojo';

export function Campo({ etiqueta, error, ayuda, children, className }: { etiqueta: string; error?: string; ayuda?: string; children: (p: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode; className?: string }) {
  const id = useId();
  const desc = error ? `${id}-e` : ayuda ? `${id}-a` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-tinta">{etiqueta}</label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': desc })}
      {error ? <p id={`${id}-e`} role="alert" className="mt-1 text-[13px] text-rojo">{error}</p>
        : ayuda ? <p id={`${id}-a`} className="mt-1 text-[13px] text-tenue">{ayuda}</p> : null}
    </div>
  );
}
export const Entrada = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(CONTROL, className)} />;
export const Selector = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(CONTROL, 'pr-7', className)}>{children}</select>;
export const AreaTexto = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...p} className={cx(CONTROL, 'h-auto py-2', className)} />;

/** Filtro compacto con etiqueta accesible (visible solo para lectores de pantalla). */
export function Filtro({ etiqueta, children }: { etiqueta: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return <div className="w-full min-w-0 sm:w-auto"><label htmlFor={id} className="sr-only">{etiqueta}</label>{children(id)}</div>;
}

// ---------- Insignias ----------
export type Tono = 'neutro' | 'verde' | 'ambar' | 'rojo' | 'marca';
const TONOS: Record<Tono, string> = {
  neutro: 'bg-panel2 text-tenue border-linea', verde: 'bg-verde-suave text-verde border-transparent',
  ambar: 'bg-ambar-suave text-ambar border-transparent', rojo: 'bg-rojo-suave text-rojo border-transparent', marca: 'bg-marca-suave text-marca border-transparent',
};
export const Insignia = ({ tono = 'neutro', children }: { tono?: Tono; children: ReactNode }) =>
  <span className={cx('inline-flex items-center gap-1 rounded-sm border px-1.5 py-px text-xs font-medium whitespace-nowrap', TONOS[tono])}>{children}</span>;

export const TONO_PEDIDO: Record<string, Tono> = { borrador: 'neutro', enviado: 'marca', parcial: 'ambar', recibido: 'verde', cancelado: 'neutro' };
export const TONO_PROVEEDOR: Record<string, Tono> = { activo: 'verde', en_revision: 'ambar', bloqueado: 'rojo', inactivo: 'neutro' };

// ---------- Estructura ----------
export function Cabecera({ titulo, descripcion, acciones }: { titulo: string; descripcion?: string; acciones?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="titulo text-2xl leading-tight">{titulo}</h1>
        {descripcion && <p className="mt-0.5 max-w-[70ch] text-tenue">{descripcion}</p>}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </header>
  );
}
export const Panel = ({ className, children }: { className?: string; children: ReactNode }) =>
  <section className={cx('min-w-0 rounded-lg border border-linea bg-panel', className)}>{children}</section>;
export const TituloPanel = ({ children, extra }: { children: ReactNode; extra?: ReactNode }) =>
  <div className="flex items-center justify-between gap-3 border-b border-linea px-4 py-2.5"><h2 className="titulo text-[15px]">{children}</h2>{extra}</div>;

export function Pestanas<T extends string>({ valor, onCambio, opciones }: { valor: T; onCambio: (v: T) => void; opciones: { id: T; etiqueta: string; cuenta?: number }[] }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--linea)]">
      {opciones.map((o) => (
        <button key={o.id} role="tab" type="button" aria-selected={valor === o.id} onClick={() => onCambio(o.id)}
          className={cx('flex items-center gap-1.5 border-b-2 px-3 py-2 font-medium whitespace-nowrap transition-colors',
            valor === o.id ? 'border-marca text-tinta' : 'border-transparent text-tenue hover:text-tinta')}>
          {o.etiqueta}
          {o.cuenta !== undefined && o.cuenta > 0 && <span className="cifra rounded-sm bg-ambar-suave px-1 text-xs text-ambar">{o.cuenta}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- Tabla ----------
export const Tabla = ({ children, minimo = 720 }: { children: ReactNode; minimo?: number }) =>
  <div className="overflow-x-auto"><table className="w-full border-collapse text-left" style={{ minWidth: minimo }}>{children}</table></div>;
export const Th = ({ children, der, className }: { children?: ReactNode; der?: boolean; className?: string }) =>
  <th scope="col" className={cx('border-b border-linea bg-panel2 px-3 py-2 text-[13px] font-medium text-tenue whitespace-nowrap first:pl-4 last:pr-4', der && 'text-right', className)}>{children}</th>;
export const Td = ({ children, der, className, colSpan }: { children?: ReactNode; der?: boolean; className?: string; colSpan?: number }) =>
  <td colSpan={colSpan} className={cx('border-b border-linea/70 px-3 py-2 align-middle first:pl-4 last:pr-4', der && 'cifra text-right whitespace-nowrap', className)}>{children}</td>;
export const filaClic = 'cursor-pointer transition-colors hover:bg-panel2 focus-visible:bg-panel2';

/** Fila clicable accesible por teclado. */
export function Fila({ onAbrir, children, marca }: { onAbrir?: () => void; children: ReactNode; marca?: Tono }) {
  const borde = marca === 'rojo' ? 'shadow-[inset_3px_0_0_var(--rojo)]' : marca === 'ambar' ? 'shadow-[inset_3px_0_0_var(--ambar)]' : '';
  if (!onAbrir) return <tr className={borde}>{children}</tr>;
  return (
    <tr tabIndex={0} className={cx(filaClic, borde)} onClick={onAbrir}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAbrir(); } }}>{children}</tr>
  );
}

export function Paginacion({ pagina, tamano, total, onCambio }: { pagina: number; tamano: number; total: number; onCambio: (p: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / tamano));
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] text-tenue">
      <span className="cifra">{(pagina - 1) * tamano + 1}–{Math.min(pagina * tamano, total)} de {total.toLocaleString('es-ES')}</span>
      <div className="flex items-center gap-1">
        <Boton pequeno disabled={pagina <= 1} onClick={() => onCambio(pagina - 1)} aria-label="Página anterior"><ChevronLeft size={15} /></Boton>
        <span className="cifra px-2">{pagina} / {paginas}</span>
        <Boton pequeno disabled={pagina >= paginas} onClick={() => onCambio(pagina + 1)} aria-label="Página siguiente"><ChevronRight size={15} /></Boton>
      </div>
    </div>
  );
}

// ---------- Estados ----------
export const Esqueleto = ({ className }: { className?: string }) => <div className={cx('esqueleto', className)} aria-hidden />;
export function EsqueletoTabla({ filas = 8, columnas = 6 }: { filas?: number; columnas?: number }) {
  return (
    <div className="p-4" role="status" aria-label="Cargando datos">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="flex gap-4 py-2.5">
          {Array.from({ length: columnas }, (_, j) => <Esqueleto key={j} className={cx('h-4', j === 0 ? 'w-1/4' : 'flex-1')} />)}
        </div>
      ))}
    </div>
  );
}
export function Vacio({ titulo, texto, accion }: { titulo: string; texto?: string; accion?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <Inbox size={28} className="mb-3 text-tenue" aria-hidden />
      <p className="font-medium">{titulo}</p>
      {texto && <p className="mt-1 max-w-[52ch] text-tenue">{texto}</p>}
      {accion && <div className="mt-4">{accion}</div>}
    </div>
  );
}
export function ErrorVista({ error, onReintentar }: { error: ErrorApi | Error; onReintentar?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-12 text-center">
      <AlertTriangle size={28} className="mb-3 text-rojo" aria-hidden />
      <p className="font-medium">No se han podido cargar los datos</p>
      <p className="mt-1 max-w-[60ch] text-tenue">{error.message}</p>
      {onReintentar && <Boton className="mt-4" onClick={onReintentar}><RotateCw size={15} />Reintentar</Boton>}
    </div>
  );
}
export const AvisoError = ({ children }: { children: ReactNode }) =>
  <div role="alert" className="flex items-start gap-2 rounded-md bg-rojo-suave px-3 py-2 text-rojo"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /><span>{children}</span></div>;

/** Envuelve una vista de datos: esqueleto en la primera carga, error con reintento, o el contenido. */
export function Carga<T>({ r, esqueleto, children }: { r: { datos: T | null; error: ErrorApi | null; cargando: boolean; recargar: () => void }; esqueleto?: ReactNode; children: (d: T) => ReactNode }) {
  if (r.error && !r.datos) return <ErrorVista error={r.error} onReintentar={r.recargar} />;
  if (!r.datos) return <>{esqueleto ?? <EsqueletoTabla />}</>;
  return (
    <div className={cx('transition-opacity', r.cargando && 'opacity-60')} aria-busy={r.cargando}>
      {r.error && <div className="p-3"><AvisoError>{r.error.message} <button type="button" className="underline" onClick={r.recargar}>Reintentar</button></AvisoError></div>}
      {children(r.datos)}
    </div>
  );
}

// ---------- Diálogo (modal centrado o panel lateral) ----------
export function Dialogo({ titulo, subtitulo, onCerrar, children, pie, lateral, ancho = 'max-w-xl' }:
  { titulo: string; subtitulo?: ReactNode; onCerrar: () => void; children: ReactNode; pie?: ReactNode; lateral?: boolean; ancho?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const idTitulo = useId();
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    const caja = ref.current!;
    const enfocables = () => [...caja.querySelectorAll<HTMLElement>('input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')];
    (caja.querySelector<HTMLElement>('[data-autofoco]') ?? enfocables().find((e) => e.dataset.cerrar === undefined) ?? caja).focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCerrar(); }
      if (e.key === 'Tab') {
        const f = enfocables(); if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', tecla);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', tecla); document.body.style.overflow = overflow; previo?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={cx('fixed inset-0 z-50 flex', lateral ? 'justify-end' : 'items-start justify-center overflow-y-auto p-3 sm:p-8')}>
      <div className="anim-fondo fixed inset-0 bg-black/45" onClick={onCerrar} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={idTitulo} tabIndex={-1}
        className={cx('relative flex w-full flex-col bg-panel shadow-panel outline-none', ancho,
          lateral ? 'anim-panel h-full border-l border-linea' : 'anim-modal my-auto max-h-none rounded-lg border border-linea')}>
        <div className="flex items-start justify-between gap-3 border-b border-linea px-5 py-3.5">
          <div className="min-w-0">
            <h2 id={idTitulo} className="titulo text-lg leading-tight">{titulo}</h2>
            {subtitulo && <div className="mt-0.5 text-[13px] text-tenue">{subtitulo}</div>}
          </div>
          <Boton variante="fantasma" pequeno onClick={onCerrar} aria-label="Cerrar" data-cerrar><X size={17} /></Boton>
        </div>
        <div className={cx('px-5 py-4', lateral && 'flex-1 overflow-y-auto')}>{children}</div>
        {pie && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-linea bg-panel2 px-5 py-3">{pie}</div>}
      </div>
    </div>
  );
}

// ---------- Avisos efímeros ----------
const CtxAviso = createContext<(texto: string, tono?: 'ok' | 'error') => void>(() => {});
export const useAviso = () => useContext(CtxAviso);
export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<{ id: number; texto: string; tono: 'ok' | 'error' }[]>([]);
  const avisar = useCallback((texto: string, tono: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setAvisos((a) => [...a, { id, texto, tono }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <CtxAviso.Provider value={avisar}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={cx('anim-modal pointer-events-auto rounded-md px-4 py-2.5 font-medium shadow-panel', a.tono === 'ok' ? 'bg-tinta text-fondo' : 'bg-rojo text-white')}>{a.texto}</div>
        ))}
      </div>
    </CtxAviso.Provider>
  );
}
