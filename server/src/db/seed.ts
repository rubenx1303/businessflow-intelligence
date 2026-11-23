/**
 * Datos de demostración coherentes: NO son filas aleatorias sueltas, sino el resultado de simular
 * 12 meses de actividad de un distribuidor de suministros de hostelería.
 *
 *  - Cada día se consume stock según la demanda base del producto, la estacionalidad de su categoría y el día de la semana.
 *  - Cada lunes "compras" revisa el stock y lanza pedidos por proveedor y almacén cuando la posición cae bajo el punto de pedido.
 *  - Cada proveedor tiene un perfil propio (plazo, puntualidad, entregas parciales, rechazos, deriva de precios), así que
 *    los retrasos, roturas de stock y desviaciones de coste que aparecen en los informes tienen una causa rastreable.
 *
 * El generador es determinista (semilla fija): dos ejecuciones el mismo día producen los mismos datos.
 */
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { migrar } from './migrate.js';
import { pool } from './pool.js';

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(20261123);
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const r4 = (n: number) => Math.round(n * 10000) / 10000;

const DIAS = 365;
const hoy = new Date(); hoy.setUTCHours(0, 0, 0, 0);
const fecha = (t: number) => new Date(hoy.getTime() - (DIAS - t) * 86400000); // t = DIAS → hoy
const iso = (d: Date) => d.toISOString().slice(0, 10);

// ---------- Maestros ----------
interface PerfilProveedor {
  codigo: string; nombre: string; cif: string; ciudad: string; plazo: number; pago: string; estado: string;
  /** Probabilidad de entregar tarde y media de días de retraso cuando ocurre. */
  pTarde: number; retraso: number;
  /** A partir de este día de la simulación la puntualidad empeora (0 = nunca). */
  empeoraDesde: number; pTardeDespues: number;
  pParcial: number; pRechazo: number; inflacionAnual: number;
}
const PROVEEDORES: PerfilProveedor[] = [
  { codigo: 'PRV-001', nombre: 'Bebidas del Turia S.A.', cif: 'DEMO00001', ciudad: 'Valencia', plazo: 3, pago: '30 días', estado: 'activo', pTarde: 0.06, retraso: 1.5, empeoraDesde: 0, pTardeDespues: 0, pParcial: 0.05, pRechazo: 0.01, inflacionAnual: 0.03 },
  { codigo: 'PRV-002', nombre: 'Cafés Mediterráneo S.L.', cif: 'DEMO00002', ciudad: 'Alicante', plazo: 5, pago: '30 días', estado: 'activo', pTarde: 0.10, retraso: 2, empeoraDesde: 0, pTardeDespues: 0, pParcial: 0.08, pRechazo: 0.01, inflacionAnual: 0.14 },
  { codigo: 'PRV-003', nombre: 'Distribuciones Alimentarias Ribera S.L.', cif: 'DEMO00003', ciudad: 'Alzira', plazo: 4, pago: '45 días', estado: 'activo', pTarde: 0.12, retraso: 2, empeoraDesde: 0, pTardeDespues: 0, pParcial: 0.15, pRechazo: 0.02, inflacionAnual: 0.04 },
  { codigo: 'PRV-004', nombre: 'Higiene Profesional Levante S.L.', cif: 'DEMO00004', ciudad: 'Castellón', plazo: 6, pago: '60 días', estado: 'activo', pTarde: 0.08, retraso: 2, empeoraDesde: 0, pTardeDespues: 0, pParcial: 0.05, pRechazo: 0.005, inflacionAnual: 0.02 },
  // El proveedor problemático: correcto durante meses y con un deterioro claro en el último trimestre.
  { codigo: 'PRV-005', nombre: 'Envases y Desechables Iberia S.A.', cif: 'DEMO00005', ciudad: 'Madrid', plazo: 8, pago: '60 días', estado: 'en_revision', pTarde: 0.15, retraso: 3, empeoraDesde: 265, pTardeDespues: 0.7, pParcial: 0.3, pRechazo: 0.04, inflacionAnual: 0.05 },
  { codigo: 'PRV-006', nombre: 'Conservas del Cantábrico S.L.', cif: 'DEMO00006', ciudad: 'Santoña', plazo: 9, pago: '30 días', estado: 'activo', pTarde: 0.2, retraso: 3, empeoraDesde: 0, pTardeDespues: 0, pParcial: 0.1, pRechazo: 0.015, inflacionAnual: 0.06 },
  { codigo: 'PRV-007', nombre: 'Menaje Hostelero Sagunto S.L.', cif: 'DEMO00007', ciudad: 'Sagunto', plazo: 7, pago: '30 días', estado: 'activo', pTarde: 0.1, retraso: 2, empeoraDesde: 0, pTardeDespues: 0, pParcial: 0.1, pRechazo: 0.06, inflacionAnual: 0.03 },
  { codigo: 'PRV-008', nombre: 'Aceites y Vinagres Sierra Mágina S.C.A.', cif: 'DEMO00008', ciudad: 'Jaén', plazo: 6, pago: '30 días', estado: 'activo', pTarde: 0.07, retraso: 2, empeoraDesde: 0, pTardeDespues: 0, pParcial: 0.05, pRechazo: 0.01, inflacionAnual: 0.18 },
  { codigo: 'PRV-009', nombre: 'Papelera del Júcar S.L. (antiguo)', cif: 'DEMO00009', ciudad: 'Cullera', plazo: 10, pago: 'Contado', estado: 'inactivo', pTarde: 0, retraso: 0, empeoraDesde: 0, pTardeDespues: 0, pParcial: 0, pRechazo: 0, inflacionAnual: 0 },
];

const ALMACENES = [
  { codigo: 'ALM-VLC', nombre: 'Central Valencia', ciudad: 'Valencia', peso: 0.55 },
  { codigo: 'ALM-ALC', nombre: 'Delegación Alicante', ciudad: 'Alicante', peso: 0.3 },
  { codigo: 'ALM-CAS', nombre: 'Delegación Castellón', ciudad: 'Castellón', peso: 0.15 },
];

/** Estacionalidad mensual por categoría (enero..diciembre). La hostelería levantina pica en verano. */
const ESTACIONALIDAD: Record<string, number[]> = {
  'Bebidas': [0.7, 0.7, 0.85, 1.0, 1.15, 1.35, 1.6, 1.65, 1.2, 0.95, 0.8, 0.95],
  'Café e infusiones': [1.1, 1.1, 1.05, 1.0, 0.95, 0.9, 0.85, 0.8, 1.0, 1.05, 1.1, 1.15],
  'Alimentación seca': [0.95, 0.95, 1.0, 1.0, 1.05, 1.1, 1.2, 1.2, 1.05, 1.0, 0.95, 1.05],
  'Limpieza e higiene': [0.95, 0.95, 1.0, 1.0, 1.05, 1.1, 1.15, 1.15, 1.05, 1.0, 0.95, 1.0],
  'Desechables y envases': [0.8, 0.8, 0.9, 1.0, 1.1, 1.3, 1.5, 1.5, 1.15, 0.95, 0.85, 0.95],
  'Conservas': [1.0, 1.0, 1.0, 1.0, 1.05, 1.1, 1.2, 1.2, 1.05, 1.0, 1.0, 1.1],
  'Menaje': [1.0, 0.9, 1.0, 1.1, 1.2, 1.2, 1.0, 0.9, 1.0, 1.0, 1.0, 1.0],
  'Aceites y condimentos': [1.0, 1.0, 1.0, 1.0, 1.05, 1.1, 1.15, 1.15, 1.05, 1.0, 1.0, 1.05],
};
const DIA_SEMANA = [0, 1.0, 0.95, 1.0, 1.1, 1.3, 0.75]; // domingo cerrado

// [sku, nombre, categoría, unidad, coste, demanda diaria total, lote, índice proveedor]
const PRODUCTOS: [string, string, string, string, number, number, number, number][] = [
  ['BEB-001', 'Agua mineral 1,5 L (pack 6)', 'Bebidas', 'pack', 1.62, 95, 48, 0],
  ['BEB-002', 'Agua mineral 0,5 L (pack 24)', 'Bebidas', 'pack', 3.85, 60, 24, 0],
  ['BEB-003', 'Refresco cola 33 cl (pack 24)', 'Bebidas', 'pack', 9.9, 42, 24, 0],
  ['BEB-004', 'Refresco naranja 33 cl (pack 24)', 'Bebidas', 'pack', 9.4, 22, 24, 0],
  ['BEB-005', 'Tónica 20 cl (pack 24)', 'Bebidas', 'pack', 11.2, 15, 12, 0],
  ['BEB-006', 'Cerveza lager 33 cl (caja 24)', 'Bebidas', 'caja', 12.8, 55, 20, 0],
  ['BEB-007', 'Cerveza sin alcohol 33 cl (caja 24)', 'Bebidas', 'caja', 13.1, 12, 10, 0],
  ['BEB-008', 'Zumo de naranja 1 L (caja 12)', 'Bebidas', 'caja', 10.5, 14, 10, 0],
  ['CAF-001', 'Café en grano natural 1 kg', 'Café e infusiones', 'kg', 13.4, 26, 12, 1],
  ['CAF-002', 'Café descafeinado en grano 1 kg', 'Café e infusiones', 'kg', 14.9, 7, 6, 1],
  ['CAF-003', 'Infusiones surtidas (caja 100)', 'Café e infusiones', 'caja', 6.2, 5, 6, 1],
  ['CAF-004', 'Azúcar en sobres (caja 1000)', 'Café e infusiones', 'caja', 8.7, 6, 5, 1],
  ['CAF-005', 'Leche UHT entera 1 L (caja 6)', 'Café e infusiones', 'caja', 5.1, 48, 30, 1],
  ['ALI-001', 'Arroz redondo 5 kg', 'Alimentación seca', 'saco', 6.9, 18, 10, 2],
  ['ALI-002', 'Harina de trigo 5 kg', 'Alimentación seca', 'saco', 4.3, 9, 10, 2],
  ['ALI-003', 'Pasta macarrón 5 kg', 'Alimentación seca', 'saco', 6.1, 8, 10, 2],
  ['ALI-004', 'Sal fina 1 kg (caja 12)', 'Alimentación seca', 'caja', 3.6, 4, 6, 2],
  ['ALI-005', 'Patatas fritas bolsa 1 kg', 'Alimentación seca', 'bolsa', 5.4, 20, 12, 2],
  ['ALI-006', 'Frutos secos surtidos 1 kg', 'Alimentación seca', 'bolsa', 9.8, 9, 8, 2],
  ['LIM-001', 'Lavavajillas industrial 10 L', 'Limpieza e higiene', 'garrafa', 14.6, 7, 4, 3],
  ['LIM-002', 'Desengrasante 5 L', 'Limpieza e higiene', 'garrafa', 8.9, 6, 4, 3],
  ['LIM-003', 'Lejía alimentaria 5 L', 'Limpieza e higiene', 'garrafa', 3.2, 8, 6, 3],
  ['LIM-004', 'Papel higiénico industrial (pack 18)', 'Limpieza e higiene', 'pack', 16.4, 11, 6, 3],
  ['LIM-005', 'Bobina secamanos (pack 6)', 'Limpieza e higiene', 'pack', 13.9, 13, 6, 3],
  ['LIM-006', 'Jabón de manos 5 L', 'Limpieza e higiene', 'garrafa', 7.5, 4, 4, 3],
  ['DES-001', 'Servilleta 2 capas 40x40 (caja 1200)', 'Desechables y envases', 'caja', 15.8, 16, 8, 4],
  ['DES-002', 'Vaso compostable 33 cl (caja 1000)', 'Desechables y envases', 'caja', 38.5, 6, 4, 4],
  ['DES-003', 'Envase take-away kraft (caja 300)', 'Desechables y envases', 'caja', 27.9, 9, 5, 4],
  ['DES-004', 'Bolsa basura 100 L (rollo 10)', 'Desechables y envases', 'rollo', 2.1, 30, 20, 4],
  ['DES-005', 'Film transparente 300 m', 'Desechables y envases', 'rollo', 7.3, 5, 6, 4],
  ['CON-001', 'Atún en aceite lata 1 kg', 'Conservas', 'lata', 9.6, 12, 12, 5],
  ['CON-002', 'Tomate triturado lata 5 kg', 'Conservas', 'lata', 5.8, 15, 12, 5],
  ['CON-003', 'Anchoa en aceite (bandeja 500 g)', 'Conservas', 'bandeja', 16.9, 4, 6, 5],
  ['CON-004', 'Aceituna rellena lata 2 kg', 'Conservas', 'lata', 6.4, 7, 6, 5],
  ['MEN-001', 'Copa de vino 35 cl (caja 6)', 'Menaje', 'caja', 11.5, 3, 4, 6],
  ['MEN-002', 'Vaso caña 20 cl (caja 12)', 'Menaje', 'caja', 8.2, 4, 4, 6],
  ['MEN-003', 'Plato llano porcelana 27 cm (caja 6)', 'Menaje', 'caja', 19.8, 2.5, 4, 6],
  ['ACE-001', 'Aceite de oliva virgen extra 5 L', 'Aceites y condimentos', 'garrafa', 34.5, 10, 6, 7],
  ['ACE-002', 'Aceite de girasol 5 L', 'Aceites y condimentos', 'garrafa', 8.9, 16, 8, 7],
  ['ACE-003', 'Vinagre de vino 5 L', 'Aceites y condimentos', 'garrafa', 4.2, 3, 4, 7],
];

async function insertar(tabla: string, cols: Record<string, string>, filas: any[][]) {
  // Inserción masiva con unnest: una consulta por lote en lugar de una por fila.
  const nombres = Object.keys(cols);
  const LOTE = 5000;
  for (let i = 0; i < filas.length; i += LOTE) {
    const trozo = filas.slice(i, i + LOTE);
    const arrays = nombres.map((_, j) => trozo.map((f) => f[j]));
    await pool.query(
      `INSERT INTO ${tabla} (${nombres.join(',')}) SELECT * FROM unnest(${nombres.map((n, j) => `$${j + 1}::${cols[n]}[]`).join(',')})`, arrays);
  }
}

export async function sembrar() {
  if (!config.SEED_ADMIN_PASSWORD) throw new Error('Define SEED_ADMIN_PASSWORD en .env antes de ejecutar el seed');
  rnd = mulberry32(20261123); // se reinicia en cada siembra: restaurar la demo da siempre los mismos datos
  await migrar();
  await pool.query(`TRUNCATE auditoria, movimientos_stock, lineas_recepcion, recepciones, lineas_pedido, pedidos_compra,
                    productos, almacenes, proveedores, usuarios, empresas RESTART IDENTITY CASCADE`);

  await pool.query(`INSERT INTO empresas (nombre, cif) VALUES ('Suministros Hosteleros Levante S.L.', 'DEMO00000')`);
  const hash = await bcrypt.hash(config.SEED_ADMIN_PASSWORD, 10);
  const dominio = config.SEED_ADMIN_EMAIL.split('@')[1];
  await insertar('usuarios', { empresa_id: 'int', email: 'text', nombre: 'text', password_hash: 'text', rol: 'text' }, [
    [1, config.SEED_ADMIN_EMAIL, 'Administración', hash, 'admin'],
    [1, `compras@${dominio}`, 'Lucía Ferrer (Compras)', hash, 'compras'],
    [1, `almacen@${dominio}`, 'Vicent Soler (Almacén)', hash, 'almacen'],
    [1, `direccion@${dominio}`, 'Amparo Gil (Dirección)', hash, 'lectura'],
  ]);

  await insertar('proveedores',
    { empresa_id: 'int', codigo: 'text', nombre: 'text', cif: 'text', email: 'text', telefono: 'text', ciudad: 'text', plazo_entrega_dias: 'int', condiciones_pago: 'text', estado: 'text', notas: 'text' },
    PROVEEDORES.map((p, i) => [1, p.codigo, p.nombre, p.cif, `pedidos@${p.codigo.toLowerCase()}.example`, `+34 000 000 ${String(i + 1).padStart(3, '0')}`, p.ciudad, p.plazo, p.pago, p.estado,
      p.estado === 'en_revision' ? 'En revisión por retrasos reiterados en el último trimestre.' : null]));
  await insertar('almacenes', { empresa_id: 'int', codigo: 'text', nombre: 'text', ciudad: 'text' }, ALMACENES.map((a) => [1, a.codigo, a.nombre, a.ciudad]));
  await insertar('productos',
    { empresa_id: 'int', sku: 'text', nombre: 'text', categoria: 'text', unidad: 'text', coste_estandar: 'numeric', stock_minimo: 'numeric', lote_compra: 'numeric', proveedor_preferente_id: 'int' },
    PRODUCTOS.map(([sku, nombre, cat, ud, coste, demanda, lote, prv]) => [1, sku, nombre, cat, ud, coste, Math.ceil(demanda * 6), lote, prv + 1]));

  // ---------- Simulación ----------
  const nP = PRODUCTOS.length, nA = ALMACENES.length;
  const stock = Array.from({ length: nP }, () => new Array<number>(nA).fill(0));
  const enCamino = Array.from({ length: nP }, () => new Array<number>(nA).fill(0));
  const movs: any[][] = [];
  const pedidos: any[][] = [], lineasPed: any[][] = [], receps: any[][] = [], lineasRec: any[][] = [];
  let idPedido = 0, idLinea = 0, idRecep = 0;
  const numeroPorAnio = new Map<number, number>();
  /** Entregas programadas: día → lista de recepciones pendientes de materializar. */
  const agenda = new Map<number, { pedido: number; almacen: number; numero: string; lineas: { linea: number; prod: number; ok: number; ko: number; precio: number }[] }[]>();
  const estadoPedido = new Map<number, { pedido: number[]; recibido: number }>(); // índice en `pedidos` + pendiente

  const ts = (t: number, hora: number) => new Date(fecha(t).getTime() + hora * 3600000).toISOString();
  const demandaDia = (i: number, a: number, d: Date) =>
    PRODUCTOS[i][5] * ALMACENES[a].peso * ESTACIONALIDAD[PRODUCTOS[i][2]][d.getUTCMonth()] * DIA_SEMANA[d.getUTCDay()];

  for (let i = 0; i < nP; i++) for (let a = 0; a < nA; a++) {
    const ini = Math.ceil(PRODUCTOS[i][5] * ALMACENES[a].peso * 22);
    stock[i][a] = ini;
    movs.push([1, i + 1, a + 1, 'INICIAL', ini, PRODUCTOS[i][4], 'Inventario inicial', null, ts(0, 6)]);
  }

  for (let t = 0; t < DIAS; t++) {
    const d = fecha(t);

    // 1) Recepciones previstas para hoy (por la mañana).
    for (const e of agenda.get(t) ?? []) {
      const rid = ++idRecep;
      receps.push([1, e.pedido, `ALB-${String(100000 + rid * 7)}`, iso(d), e.lineas.some((l) => l.ko > 0) ? 'Mercancía dañada devuelta al transportista.' : null]);
      for (const l of e.lineas) {
        lineasRec.push([rid, l.linea, l.ok, l.ko]);
        if (l.ok > 0) {
          stock[l.prod][e.almacen] += l.ok;
          enCamino[l.prod][e.almacen] -= l.ok;
          movs.push([1, l.prod + 1, e.almacen + 1, 'ENTRADA_COMPRA', l.ok, l.precio, `${e.numero} / ALB-${100000 + rid * 7}`, rid, ts(t, 9)]);
        }
        estadoPedido.get(e.pedido)!.recibido += l.ok;
      }
    }

    // 2) Consumo del día (limitado por el stock: si no hay, se pierde la venta).
    if (d.getUTCDay() !== 0) {
      for (let i = 0; i < nP; i++) for (let a = 0; a < nA; a++) {
        const mu = demandaDia(i, a, d);
        const pedida = Math.max(0, Math.round(mu + Math.sqrt(mu) * 0.9 * gauss()));
        const sale = Math.min(pedida, stock[i][a]);
        if (sale > 0) {
          stock[i][a] -= sale;
          movs.push([1, i + 1, a + 1, 'SALIDA_CONSUMO', -sale, PRODUCTOS[i][4], 'Salida a clientes', null, ts(t, 18)]);
        }
      }
    }

    // 3) Revisión semanal de compras (lunes): política sencilla basada en el plazo ACORDADO, no en el real.
    //    Entre revisiones nadie vigila el stock: ahí es donde el motor de reposición aporta valor.
    if (d.getUTCDay() === 1) {
      for (let a = 0; a < nA; a++) for (let s = 0; s < PROVEEDORES.length; s++) {
        const pr = PROVEEDORES[s];
        if (pr.estado === 'inactivo') continue;
        const lineas: { prod: number; cant: number; precio: number }[] = [];
        for (let i = 0; i < nP; i++) {
          if (PRODUCTOS[i][7] !== s) continue;
          const mu = demandaDia(i, a, d) / DIA_SEMANA[d.getUTCDay()] * 0.87; // media diaria aproximada de la semana
          const rop = mu * (pr.plazo + 6);
          const pos = stock[i][a] + enCamino[i][a];
          if (pos > rop) continue;
          const lote = PRODUCTOS[i][6];
          const cant = Math.max(lote, Math.ceil((mu * (pr.plazo + 21) - pos) / lote) * lote);
          const precio = r4(PRODUCTOS[i][4] * (1 + pr.inflacionAnual * (t / DIAS - 0.5)) * (1 + 0.015 * gauss()));
          lineas.push({ prod: i, cant, precio });
        }
        if (!lineas.length) continue;

        const pid = ++idPedido;
        const anio = d.getUTCFullYear();
        const n = (numeroPorAnio.get(anio) ?? 0) + 1; numeroPorAnio.set(anio, n);
        const numero = `PC-${anio}-${String(n).padStart(4, '0')}`;
        pedidos.push([pid, 1, numero, s + 1, a + 1, 'enviado', iso(d), iso(fecha(t + pr.plazo)), a === 0 ? 2 : 2]);
        estadoPedido.set(pid, { pedido: [pedidos.length - 1, lineas.reduce((x, l) => x + l.cant, 0)], recibido: 0 });

        const pTarde = pr.empeoraDesde && t >= pr.empeoraDesde ? pr.pTardeDespues : pr.pTarde;
        const tarde = rnd() < pTarde;
        const llegada = t + pr.plazo + (tarde ? 1 + Math.round(Math.abs(gauss()) * pr.retraso * (pr.empeoraDesde && t >= pr.empeoraDesde ? 1.8 : 1)) : (rnd() < 0.15 ? -1 : 0));
        const parcial = rnd() < pr.pParcial;
        const primera: any[] = [], segunda: any[] = [];
        for (const l of lineas) {
          const lid = ++idLinea;
          lineasPed.push([pid, l.prod + 1, l.cant, l.precio]);
          enCamino[l.prod][a] += l.cant;
          const lote = PRODUCTOS[l.prod][6];
          let ahora = l.cant;
          if (parcial && l.cant >= 2 * lote) ahora = Math.max(lote, Math.round(l.cant * 0.6 / lote) * lote);
          const ko = rnd() < pr.pRechazo ? Math.max(1, Math.round(ahora * (0.03 + rnd() * 0.07))) : 0;
          primera.push({ linea: lid, prod: l.prod, ok: ahora - ko, ko, precio: l.precio });
          if (l.cant - ahora + ko > 0) segunda.push({ linea: lid, prod: l.prod, ok: l.cant - ahora + ko, ko: 0, precio: l.precio });
        }
        const programar = (dia: number, ls: any[]) => {
          if (!ls.length) return;
          if (!agenda.has(dia)) agenda.set(dia, []);
          agenda.get(dia)!.push({ pedido: pid, almacen: a, numero, lineas: ls });
        };
        programar(Math.max(llegada, t + 1), primera);
        programar(Math.max(llegada, t + 1) + 3 + Math.floor(rnd() * 5), segunda);
      }
    }
  }

  // Estado final de cada pedido según lo realmente recibido hasta ayer.
  for (const [, e] of estadoPedido) {
    const [idx, total] = e.pedido;
    pedidos[idx][5] = e.recibido >= total ? 'recibido' : e.recibido > 0 ? 'parcial' : 'enviado';
  }

  await insertar('pedidos_compra',
    { id: 'int', empresa_id: 'int', numero: 'text', proveedor_id: 'int', almacen_id: 'int', estado: 'text', fecha_pedido: 'date', fecha_entrega_prevista: 'date', creado_por: 'int' }, pedidos);
  await insertar('lineas_pedido', { pedido_id: 'int', producto_id: 'int', cantidad: 'numeric', precio_unitario: 'numeric' }, lineasPed);
  await insertar('recepciones', { empresa_id: 'int', pedido_id: 'int', albaran: 'text', fecha_recepcion: 'date', notas: 'text' }, receps);
  await insertar('lineas_recepcion', { recepcion_id: 'int', linea_pedido_id: 'int', cantidad_recibida: 'numeric', cantidad_rechazada: 'numeric' }, lineasRec);
  await insertar('movimientos_stock',
    { empresa_id: 'int', producto_id: 'int', almacen_id: 'int', tipo: 'text', cantidad: 'numeric', coste_unitario: 'numeric', referencia: 'text', recepcion_id: 'int', fecha: 'timestamptz' }, movs);
  await pool.query(`SELECT setval('pedidos_compra_id_seq', (SELECT max(id) FROM pedidos_compra))`);
  await pool.query(`INSERT INTO auditoria (empresa_id, usuario_id, accion, entidad, detalle) VALUES (1, 1, 'seed', 'sistema', $1)`,
    [JSON.stringify({ pedidos: pedidos.length, recepciones: receps.length, movimientos: movs.length })]);

  return { proveedores: PROVEEDORES.length, productos: nP, pedidos: pedidos.length, lineas: lineasPed.length, recepciones: receps.length, movimientos: movs.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  sembrar()
    .then((r) => console.log('Datos de demostración generados:', r))
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => pool.end());
}
