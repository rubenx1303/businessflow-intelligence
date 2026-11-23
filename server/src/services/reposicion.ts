/**
 * Recomendación de reposición por reglas matemáticas verificables (sin IA):
 *
 *   d   = consumo medio diario (ventana de 90 días, contando los días sin consumo)
 *   σ   = desviación típica del consumo diario en esa ventana
 *   L   = plazo de entrega real medio del proveedor preferente (días)
 *   SS  = z · σ · √L                    stock de seguridad (z = 1,65 ≈ 95 % de nivel de servicio)
 *   ROP = d · L + SS                    punto de pedido
 *   PI  = stock + en camino             posición de inventario
 *   Si PI ≤ ROP → pedir  Q = d · (L + R) + SS − PI, redondeado hacia arriba al lote de compra
 *   (R = días de cobertura objetivo tras la entrega).
 */
export interface EntradaReposicion {
  stock: number;
  enCamino: number;
  consumoMedioDiario: number;
  sigmaDiaria: number;
  plazoDias: number;
  loteCompra: number;
  stockMinimo: number;
}
export interface ParametrosReposicion { z: number; diasCobertura: number }
export const PARAMETROS_POR_DEFECTO: ParametrosReposicion = { z: 1.65, diasCobertura: 30 };

export type Urgencia = 'critica' | 'alta' | 'vigilar' | 'ok' | 'sin_consumo';
export interface ResultadoReposicion {
  stockSeguridad: number;
  puntoPedido: number;
  posicionInventario: number;
  diasCobertura: number | null;
  cantidadSugerida: number;
  urgencia: Urgencia;
  motivo: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function calcularReposicion(e: EntradaReposicion, p: ParametrosReposicion = PARAMETROS_POR_DEFECTO): ResultadoReposicion {
  const d = Math.max(e.consumoMedioDiario, 0);
  const L = Math.max(e.plazoDias, 0);
  const ss = p.z * Math.max(e.sigmaDiaria, 0) * Math.sqrt(L);
  // El mínimo fijado a mano actúa de suelo: nunca se recomienda dejar caer el stock por debajo.
  const rop = Math.max(d * L + ss, e.stockMinimo);
  const pi = e.stock + e.enCamino;
  const cobertura = d > 0 ? e.stock / d : null;

  let cantidad = 0;
  if (pi <= rop) {
    const objetivo = Math.max(d * (L + p.diasCobertura) + ss, e.stockMinimo);
    const bruto = objetivo - pi;
    cantidad = bruto > 0 ? Math.ceil(bruto / e.loteCompra - 1e-9) * e.loteCompra : 0;
  }

  let urgencia: Urgencia, motivo: string;
  if (d === 0 && e.stock >= e.stockMinimo) {
    urgencia = 'sin_consumo'; motivo = 'Sin consumo en los últimos 90 días';
  } else if (e.stock <= 0) {
    urgencia = 'critica'; motivo = 'Sin existencias';
  } else if (cobertura !== null && cobertura < L && e.enCamino === 0) {
    urgencia = 'critica'; motivo = `El stock cubre ${cobertura.toFixed(0)} días y el proveedor tarda ${L.toFixed(0)}: rotura probable`;
  } else if (pi <= rop) {
    urgencia = 'alta'; motivo = 'Posición de inventario por debajo del punto de pedido';
  } else if (e.stock < e.stockMinimo) {
    urgencia = 'vigilar'; motivo = 'Bajo mínimo, pero el pedido en camino cubre la necesidad';
  } else {
    urgencia = 'ok'; motivo = 'Cobertura suficiente';
  }

  return {
    stockSeguridad: r2(ss), puntoPedido: r2(rop), posicionInventario: r2(pi),
    diasCobertura: cobertura === null ? null : r2(cobertura), cantidadSugerida: r2(cantidad), urgencia, motivo,
  };
}

/** Puntuación 0-100 del proveedor: 60 % puntualidad, 25 % calidad (rechazos), 15 % magnitud del retraso. */
export function puntuarProveedor(m: { otd: number | null; tasaRechazo: number | null; retrasoMedio: number | null }): number | null {
  if (m.otd === null) return null;
  const calidad = 1 - Math.min(1, (m.tasaRechazo ?? 0) * 10); // 10 % de rechazo = 0 puntos de calidad
  const retraso = 1 - Math.min(1, (m.retrasoMedio ?? 0) / 10); // 10 días de retraso medio = 0 puntos
  return Math.round(100 * (0.6 * m.otd + 0.25 * calidad + 0.15 * retraso));
}
