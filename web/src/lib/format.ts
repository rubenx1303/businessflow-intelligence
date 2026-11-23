const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('es-ES', o);
const fEur = nf({ style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
const fEur0 = nf({ style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fEurK = nf({ style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 });
const fEur4 = nf({ style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 });

const vacio = (n: unknown): n is null | undefined => n === null || n === undefined || Number.isNaN(n);

export const eur = (n: number | null | undefined) => (vacio(n) ? '—' : fEur.format(n));
export const eur0 = (n: number | null | undefined) => (vacio(n) ? '—' : fEur0.format(n));
export const eurK = (n: number | null | undefined) => (vacio(n) ? '—' : fEurK.format(n));
export const precio = (n: number | null | undefined) => (vacio(n) ? '—' : fEur4.format(n));
export const num = (n: number | null | undefined, dec = 0) =>
  vacio(n) ? '—' : nf({ minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: 'always' } as Intl.NumberFormatOptions).format(n);
/** Cantidades de stock: sin decimales salvo que los haya. */
export const cant = (n: number | null | undefined) => (vacio(n) ? '—' : nf({ maximumFractionDigits: 3 }).format(n));
export const pct = (n: number | null | undefined, dec = 0) => (vacio(n) ? '—' : nf({ style: 'percent', minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n));
export const pctSigno = (n: number | null | undefined, dec = 1) =>
  vacio(n) ? '—' : nf({ style: 'percent', minimumFractionDigits: dec, maximumFractionDigits: dec, signDisplay: 'exceptZero' }).format(n);

const fFecha = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
const fFechaHora = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fMes = new Intl.DateTimeFormat('es-ES', { month: 'short', year: '2-digit' });

/** Acepta 'YYYY-MM-DD' (se interpreta como fecha local, sin desfase de zona) o ISO completo. */
function aFecha(v: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)) : new Date(v);
}
export const fecha = (v: string | null | undefined) => (v ? fFecha.format(aFecha(v)).replace('.', '') : '—');
export const fechaHora = (v: string | null | undefined) => (v ? fFechaHora.format(aFecha(v)).replace('.', '') : '—');
export const mes = (v: string) => fMes.format(new Date(+v.slice(0, 4), +v.slice(5, 7) - 1, 1)).replace('.', '');

export function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const hoyMas = (dias: number) => { const d = new Date(); d.setDate(d.getDate() + dias); return isoLocal(d); };

export const ETIQUETA_ESTADO_PROVEEDOR: Record<string, string> = { activo: 'Activo', en_revision: 'En revisión', bloqueado: 'Bloqueado', inactivo: 'Inactivo' };
export const ETIQUETA_ESTADO_PEDIDO: Record<string, string> = { borrador: 'Borrador', enviado: 'Enviado', parcial: 'Recibido parcial', recibido: 'Recibido', cancelado: 'Cancelado' };
export const ETIQUETA_TIPO_MOV: Record<string, string> = { ENTRADA_COMPRA: 'Entrada por compra', SALIDA_CONSUMO: 'Salida', AJUSTE: 'Ajuste', INICIAL: 'Inventario inicial' };
export const ETIQUETA_ROL: Record<string, string> = { admin: 'Administración', compras: 'Compras', almacen: 'Almacén', lectura: 'Solo lectura' };
