import { useCallback, useEffect, useRef, useState } from 'react';

export type Rol = 'admin' | 'compras' | 'almacen' | 'lectura';
export interface Usuario { id: number; email: string; nombre: string; rol: Rol; empresa?: string }

export interface Proveedor {
  id: number; codigo: string; nombre: string; cif: string; email: string | null; telefono: string | null; ciudad: string | null;
  pais: string; plazo_entrega_dias: number; condiciones_pago: string; estado: 'activo' | 'en_revision' | 'bloqueado' | 'inactivo';
  notas: string | null; pedidos_abiertos?: number;
}
export interface MetricasProveedor {
  proveedor_id: number; codigo: string; nombre: string; estado: string; plazo_acordado: number; pedidos: number; completados: number;
  gasto: number; otd: number | null; retraso_medio: number | null; plazo_real: number | null; tasa_rechazo: number | null; puntuacion: number | null;
}
export interface Almacen { id: number; codigo: string; nombre: string; ciudad: string | null; activo: boolean; valor_stock: number }
export interface Producto {
  id: number; sku: string; nombre: string; categoria: string; unidad: string; coste_estandar: number; stock_minimo: number; lote_compra: number;
  proveedor_preferente_id: number | null; proveedor_nombre: string | null; activo: boolean; stock: number; valor_stock: number;
  situacion: 'ok' | 'bajo_minimo' | 'sin_stock';
}
export interface Movimiento {
  id: number; fecha: string; tipo: string; cantidad: number; coste_unitario: number; referencia: string | null;
  sku: string; producto: string; unidad: string; almacen: string;
}
export interface Pagina<T> { total: number; pagina: number; tamano: number; filas: T[] }
export type EstadoPedido = 'borrador' | 'enviado' | 'parcial' | 'recibido' | 'cancelado';
export interface PedidoResumen {
  id: number; numero: string; estado: EstadoPedido; fecha_pedido: string; fecha_entrega_prevista: string; proveedor: string; almacen: string;
  importe: number; lineas: number; pct_recibido: number; retrasado: boolean;
}
export interface LineaPedido {
  id: number; producto_id: number; sku: string; producto: string; unidad: string; cantidad: number; precio_unitario: number;
  recibido: number; rechazado: number; pendiente: number; importe: number;
}
export interface Recepcion {
  id: number; albaran: string; fecha_recepcion: string; notas: string | null;
  lineas: { linea_pedido_id: number; recibida: number; rechazada: number }[] | null;
}
export interface PedidoDetalle {
  id: number; numero: string; estado: EstadoPedido; fecha_pedido: string; fecha_entrega_prevista: string; proveedor_id: number; almacen_id: number;
  proveedor: string; almacen: string; notas: string | null; importe: number; lineas: LineaPedido[]; recepciones: Recepcion[];
}
export interface Dashboard {
  periodo: { desde: string; hasta: string; dias: number };
  kpis: {
    gasto_compras: number; pedidos: number; valor_inventario: number; productos_bajo_minimo: number; entregas_puntuales: number | null;
    retraso_medio_dias: number | null; consumo_valorado: number; rotacion_inventario: number | null; pedidos_abiertos: number; pedidos_retrasados: number;
    pedidos_completados: number; pedidos_con_retraso: number;
  };
  consumo_mensual: { mes: string; valor: number }[];
  distribucion_retraso: { tramo: string; pedidos: number }[];
  gasto_mensual: { mes: string; gasto: number; pedidos: number }[];
  consumo_categoria: { categoria: string; valor: number; unidades: number }[];
  top_proveedores: MetricasProveedor[];
  alertas: {
    bajo_minimo: { id: number; sku: string; nombre: string; categoria: string; unidad: string; stock_minimo: number; stock: number }[];
    pedidos_retrasados: { id: number; numero: string; proveedor: string; fecha_entrega_prevista: string; dias_retraso: number }[];
  };
}
export type Urgencia = 'critica' | 'alta' | 'vigilar' | 'ok' | 'sin_consumo';
export interface FilaReposicion {
  producto_id: number; sku: string; nombre: string; categoria: string; unidad: string; coste_estandar: number; stock_minimo: number; lote_compra: number;
  proveedor_id: number | null; proveedor: string | null; proveedor_estado: string | null; stock: number; en_camino: number;
  consumo_medio_diario: number; sigma_diaria: number; plazo_dias: number; plazo_es_real: boolean; stock_seguridad: number; punto_pedido: number;
  posicion_inventario: number; dias_cobertura: number | null; cantidad_sugerida: number; urgencia: Urgencia; motivo: string; importe_sugerido: number;
}
export interface Reposicion { parametros: { z: number; diasCobertura: number }; filas: FilaReposicion[] }
export interface FilaCoste {
  producto_id: number; sku: string; nombre: string; categoria: string; coste_estandar: number; gasto_12m: number; unidades_12m: number;
  precio_medio_12m: number | null; precio_reciente: number | null; precio_anterior: number | null; variacion_precio: number | null; desviacion_estandar: number | null;
}
export interface Auditoria { id: number; fecha: string; accion: string; entidad: string; entidad_id: string | null; detalle: unknown; usuario: string | null }
export interface Historial {
  metricas: MetricasProveedor | null;
  pedidos: { id: number; numero: string; estado: EstadoPedido; fecha_pedido: string; fecha_entrega_prevista: string; ultima_recepcion: string | null; importe: number }[];
  cambios: { fecha: string; accion: string; detalle: Record<string, { antes: unknown; despues: unknown }> | Record<string, unknown> | null; usuario: string | null }[];
}

// ---------- Informes sobre Gold ----------
export interface KpisInforme {
  gasto_compras: number; pedidos: number; pedidos_completados: number; entregas_puntuales: number | null; retraso_medio_dias: number | null;
  plazo_real_medio_dias: number | null; valor_inventario: number; productos_bajo_minimo: number; consumo_valorado: number; consumo_unidades: number;
  tasa_rechazo: number | null; rotacion_inventario: number | null;
}
export interface LineaCuadre { campo: string; medida_dax: string; operativo: number | null; gold: number | null; coincide: boolean }
export interface Informes {
  disponible: true;
  periodo: { desde: string; hasta: string; dias: number };
  ejecucion: { id_ejecucion?: string; fin?: string; motor?: string };
  kpis: KpisInforme;
  gasto_mensual: { anio_mes: string; gasto: number; pedidos: number; variacion: number | null; acumulado_anio: number; media_movil_3m: number }[];
  proveedores: {
    proveedor_id: number; codigo: string; nombre: string; estado: string; plazo_acordado_dias: number; pedidos: number; completados: number; gasto: number;
    cuota_gasto: number; ranking_gasto: number; entregas_puntuales: number | null; retraso_medio_dias: number | null; plazo_real_dias: number | null;
    desviacion_plazo_dias: number | null; tasa_rechazo: number | null;
  }[];
  puntualidad_trimestral: { codigo: string; nombre: string; periodo: string; pedidos: number; entregas_puntuales: number; retraso_medio_dias: number; variacion: number | null }[];
  consumo_categoria: { categoria: string; consumo_valorado: number; unidades: number; cuota: number | null; valor_inventario: number; bajo_minimo: number; rotacion: number | null }[];
  inventario_mensual: { anio_mes: string; valor_cierre: number; valor_medio: number; max_roturas_dia: number }[];
  cuadre: { al_dia: boolean; lineas: LineaCuadre[] };
}
export type RespuestaInformes = Informes | { disponible: false };

// ---------- Circuito de datos ----------
export interface Ejecucion {
  id_ejecucion: string; motor: string; inicio: string; fin: string; estado: string;
  duracion_ms: { bronze: number; silver: number; gold: number; total: number };
  bronze: { id_carga: string; total_filas: number; tablas: { tabla: string; modo: string; filas: number; marca_agua: unknown }[] };
  silver: {
    tablas: { tabla: string; cargas_leidas: number; filas_leidas: number; duplicadas_eliminadas: number; rechazadas: number; escritas: number; ms?: number }[];
    rechazos: unknown;
    totales: { filas_leidas: number; duplicadas_eliminadas: number; rechazadas: number; escritas: number };
  };
  gold: { tablas: { tabla: string; grano: string; filas: number }[]; controles: Record<string, number> };
}
export interface EvidenciasFabric {
  nota: string; fecha: string;
  capacidad: { nombre: string; sku: string; region: string; suscripcion: string; estado: string; estado_verificado: string; encendida: string };
  recursos: { tipo: string; nombre: string; detalle?: string }[];
  bronze: { archivos_subidos: number; bytes: number; destino: string };
  silver: { id_ejecucion: string; segundos: number; totales: Ejecucion['silver']['totales']; tablas: Ejecucion['silver']['tablas'] };
  gold: { segundos: number; tablas: { tabla: string; filas: number }[] };
  warehouse: { objeto: string; tipo: string; detalle?: string }[];
  validacion_dax: { medida: string; aplicacion: number; fabric: number }[];
  incidencias: string[];
  no_demostrado_en_fabric: string[];
}
export interface EstadoDatos {
  en_curso: string | null;
  capas: Record<'bronze' | 'silver' | 'gold', { archivos: number; bytes: number }>;
  ultima: Ejecucion | null;
  historial: { id_ejecucion: string; fin: string; duracion_ms: number | null; filas_bronze: number | null; duplicadas: number | null; rechazadas: number | null; escritas_silver: number | null }[];
  reglas_silver: { tabla: string; reglas: string[]; referencias: string[] }[];
  modelo_gold: { tabla: string; grano: string }[];
  fabric: EvidenciasFabric | null;
}

export class ErrorApi extends Error {
  constructor(public status: number, mensaje: string, public codigo: string, public campos: { campo: string; mensaje: string }[] = []) { super(mensaje); }
  /** Errores de validación indexados por nombre de campo (p. ej. "lineas.0.cantidad"). */
  porCampo(): Record<string, string> { return Object.fromEntries(this.campos.map((c) => [c.campo, c.mensaje])); }
}

const CLAVE = 'bfi-token';
export const sesion = {
  token: () => { try { return localStorage.getItem(CLAVE); } catch { return null; } },
  guardar: (t: string) => { try { localStorage.setItem(CLAVE, t); } catch { /* sin almacenamiento */ } },
  borrar: () => { try { localStorage.removeItem(CLAVE); } catch { /* sin almacenamiento */ } },
};
let alCaducar: () => void = () => {};
export const onSesionCaducada = (fn: () => void) => { alCaducar = fn; };

type Params = Record<string, string | number | boolean | null | undefined>;

async function pedir<T>(metodo: string, ruta: string, opciones: { params?: Params; cuerpo?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opciones.params ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const url = `/api${ruta}${qs.size ? `?${qs}` : ''}`;
  const t = sesion.token();
  let r: Response;
  try {
    r = await fetch(url, {
      method: metodo, signal: opciones.signal,
      headers: { ...(opciones.cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ErrorApi(0, 'No hay conexión con el servidor. Comprueba que la API está en marcha.', 'RED');
  }
  if (r.ok) return r.status === 204 ? (undefined as T) : r.json();
  let j: any = null;
  try { j = await r.json(); } catch { /* respuesta sin JSON */ }
  if (r.status === 401 && !ruta.startsWith('/auth/login')) alCaducar();
  throw new ErrorApi(r.status, j?.error ?? `Error ${r.status} del servidor`, j?.codigo ?? 'ERROR', j?.campos ?? []);
}

export const api = {
  get: <T,>(ruta: string, params?: Params, signal?: AbortSignal) => pedir<T>('GET', ruta, { params, signal }),
  post: <T,>(ruta: string, cuerpo?: unknown) => pedir<T>('POST', ruta, { cuerpo: cuerpo ?? {} }),
  put: <T,>(ruta: string, cuerpo: unknown) => pedir<T>('PUT', ruta, { cuerpo }),
};

/** Carga de datos con estados de carga/error, cancelación al cambiar dependencias y recarga manual. */
export function useDatos<T>(cargar: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const [estado, setEstado] = useState<{ datos: T | null; error: ErrorApi | null; cargando: boolean }>({ datos: null, error: null, cargando: true });
  const [n, setN] = useState(0);
  const fn = useRef(cargar);
  fn.current = cargar;
  useEffect(() => {
    const c = new AbortController();
    setEstado((e) => ({ ...e, cargando: true, error: null }));
    fn.current(c.signal)
      .then((datos) => setEstado({ datos, error: null, cargando: false }))
      .catch((e) => { if (e?.name !== 'AbortError') setEstado((prev) => ({ datos: prev.datos, error: e instanceof ErrorApi ? e : new ErrorApi(0, String(e?.message ?? e), 'ERROR'), cargando: false })); });
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  const recargar = useCallback(() => setN((x) => x + 1), []);
  return { ...estado, recargar };
}

/** Devuelve el valor con retardo: evita una petición por cada tecla en las búsquedas. */
export function useRetardo<T>(valor: T, ms = 300): T {
  const [v, setV] = useState(valor);
  useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}

const PERMISOS: Record<string, Rol[]> = {
  proveedores: ['compras'], productos: ['compras'], pedidos: ['compras'], recepciones: ['compras', 'almacen'],
  movimientos: ['almacen'], almacenes: [], auditoria: [], pipeline: ['compras', 'almacen'], restaurar: [],
};
export const puede = (rol: Rol | undefined, accion: keyof typeof PERMISOS | string) => !!rol && (rol === 'admin' || (PERMISOS[accion] ?? []).includes(rol));
