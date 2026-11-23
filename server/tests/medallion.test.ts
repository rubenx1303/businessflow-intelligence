/**
 * Pruebas de extremo a extremo del modo demostración: datos ficticios → Bronze → Silver → Gold → informes,
 * todo en local (PostgreSQL + DuckDB). No interviene ningún servicio de Azure.
 */
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearApp } from '../src/app.js';
import { conectarDuck, filas, posix, rutas, ultimaEjecucion, una } from '../src/data/lake.js';
import { construirGold, construirSilver, ejecutarPipeline } from '../src/data/medallion.js';
import { pool, q } from '../src/db/pool.js';
import { sembrar } from '../src/db/seed.js';

const app = crearApp();
const LARGO = 180_000;
const token: Record<string, string> = {};
const como = (rol: string) => ({ Authorization: `Bearer ${token[rol]}` });
const get = async (ruta: string, rol = 'lectura') => (await request(app).get(ruta).set(como(rol))).body;
const cuenta = async (tabla: string) => (await q(`SELECT count(*)::int AS n FROM ${tabla}`))[0].n as number;

beforeAll(async () => {
  expect((await q('SELECT current_database() AS db'))[0].db).toBe('businessflow_test');
  expect(rutas().raiz.endsWith('lake_test')).toBe(true); // salvaguarda: jamás el lake de la demo
  fs.rmSync(rutas().raiz, { recursive: true, force: true });
  await sembrar();
  for (const rol of ['admin', 'compras', 'almacen', 'lectura']) {
    token[rol] = (await request(app).post('/api/auth/demo').send({ rol })).body.token;
    expect(token[rol]).toBeTruthy();
  }
}, LARGO);

afterAll(async () => {
  fs.rmSync(rutas().raiz, { recursive: true, force: true });
  await pool.end();
});

describe('datos de demostración', () => {
  it('se generan de forma determinista y coherente', async () => {
    expect(await cuenta('proveedores')).toBe(9);
    expect(await cuenta('productos')).toBe(40);
    expect(await cuenta('pedidos_compra')).toBeGreaterThan(500);
    // Coherencia: ningún producto/almacén con stock negativo y ninguna línea con más recibido que pedido.
    expect((await q('SELECT count(*)::int AS n FROM v_existencias WHERE stock < 0'))[0].n).toBe(0);
    expect((await q('SELECT count(*)::int AS n FROM v_lineas_pedido_estado WHERE recibido > cantidad'))[0].n).toBe(0);
    // El estado del pedido es consistente con lo recibido.
    expect((await q(`SELECT count(*)::int AS n FROM pedidos_compra pc WHERE pc.estado = 'recibido'
                      AND EXISTS (SELECT 1 FROM v_lineas_pedido_estado v WHERE v.pedido_id = pc.id AND v.pendiente > 0)`))[0].n).toBe(0);
  });

  it('volver a sembrar produce exactamente los mismos datos', async () => {
    const huella = async () => (await q(`SELECT (SELECT count(*) FROM pedidos_compra) AS p, (SELECT sum(cantidad * precio_unitario) FROM lineas_pedido) AS i, (SELECT sum(cantidad) FROM movimientos_stock) AS s`))[0];
    const antes = await huella();
    await sembrar();
    expect(await huella()).toEqual(antes);
  }, LARGO);
});

describe('circuito Bronze → Silver → Gold en local', () => {
  let primera: Awaited<ReturnType<typeof ejecutarPipeline>>;

  it('Bronze conserva los datos originales y Silver escribe tantas filas como hay en origen', async () => {
    primera = await ejecutarPipeline();
    expect(primera.estado).toBe('correcta');
    for (const t of primera.silver.tablas) {
      expect(t.escritas, t.tabla).toBe(await cuenta(t.tabla));
      expect(t.rechazadas, t.tabla).toBe(0);
    }
    // Bronze es una copia fiel: mismas filas y misma suma que PostgreSQL, más las columnas de trazabilidad.
    const con = await conectarDuck();
    const b = await una(con, `SELECT count(*)::INTEGER AS n, sum(cantidad)::DOUBLE AS s, count(DISTINCT _id_carga)::INTEGER AS cargas,
                                     bool_and(_origen LIKE 'postgresql://%')::BOOLEAN AS origen
                              FROM read_parquet('${posix(path.join(rutas().bronze, 'movimientos_stock'))}/*/*.parquet')`);
    con.closeSync?.();
    expect(b.n).toBe(await cuenta('movimientos_stock'));
    expect(b.s).toBeCloseTo((await q('SELECT sum(cantidad) AS s FROM movimientos_stock'))[0].s, 3);
    expect(b).toMatchObject({ cargas: 1, origen: true });
  }, LARGO);

  it('Gold respeta la granularidad declarada de cada tabla', async () => {
    const porTabla = Object.fromEntries(primera.gold.tablas.map((t: any) => [t.tabla, t.filas]));
    expect(porTabla.dim_proveedor).toBe(9);
    expect(porTabla.dim_producto).toBe(40);
    expect(porTabla.dim_almacen).toBe(3);
    expect(porTabla.fact_compras).toBe(await cuenta('lineas_pedido'));              // una fila por línea de pedido
    expect(porTabla.fact_recepciones).toBe(await cuenta('lineas_recepcion'));       // una fila por línea de recepción
    expect(porTabla.fact_movimientos_inventario).toBe(await cuenta('movimientos_stock')); // una fila por movimiento
    expect(Object.entries(primera.gold.controles).filter(([k]) => k.startsWith('huerfanas_')).every(([, v]) => v === 0)).toBe(true);
  });

  it('los indicadores calculados sobre Gold coinciden con los de la base operativa', async () => {
    const inf = await get('/api/informes');
    expect(inf.disponible).toBe(true);
    expect(inf.cuadre.lineas).toHaveLength(8);
    for (const l of inf.cuadre.lineas) expect(l.coincide, `${l.medida_dax}: operativo=${l.operativo} gold=${l.gold}`).toBe(true);
    expect(inf.cuadre.al_dia).toBe(true);
    // Contraste independiente con SQL directo sobre PostgreSQL.
    const [sql] = await q(`SELECT sum(lp.cantidad * lp.precio_unitario) AS gasto FROM lineas_pedido lp JOIN pedidos_compra pc ON pc.id = lp.pedido_id
                            WHERE pc.estado NOT IN ('borrador','cancelado') AND pc.fecha_pedido BETWEEN CURRENT_DATE - 364 AND CURRENT_DATE`);
    expect(inf.kpis.gasto_compras).toBeCloseTo(sql.gasto, 2);
    expect(inf.gasto_mensual.reduce((s: number, m: any) => s + m.gasto, 0)).toBeCloseTo(inf.kpis.gasto_compras, 2);
    expect(inf.inventario_mensual.at(-1).valor_cierre).toBeCloseTo(inf.kpis.valor_inventario, 2); // semiaditivo: el último cierre es el valor actual
  });

  it('una segunda ejecución es incremental en movimientos y Silver deduplica las instantáneas repetidas', async () => {
    const segunda = await ejecutarPipeline();
    const mov = segunda.bronze.tablas.find((t: any) => t.tabla === 'movimientos_stock');
    expect(mov).toMatchObject({ modo: 'incremental', filas: 0 });
    const prov = segunda.silver.tablas.find((t: any) => t.tabla === 'proveedores');
    expect(prov).toMatchObject({ cargas_leidas: 2, filas_leidas: 18, duplicadas_eliminadas: 9, escritas: 9 });
    expect(segunda.silver.totales.escritas).toBe(primera.silver.totales.escritas);
  }, LARGO);
});

describe('filtros del panel', () => {
  it('el gasto por proveedor suma el total y coincide con SQL directo', async () => {
    const total = (await get('/api/dashboard')).kpis;
    let suma = 0;
    for (const { id } of await q('SELECT id FROM proveedores')) suma += (await get(`/api/dashboard?proveedor_id=${id}`)).kpis.gasto_compras;
    expect(suma).toBeCloseTo(total.gasto_compras, 2);

    const p5 = await get('/api/dashboard?proveedor_id=5');
    const [sql] = await q(`SELECT sum(lp.cantidad * lp.precio_unitario) AS g FROM lineas_pedido lp JOIN pedidos_compra pc ON pc.id = lp.pedido_id
                            WHERE pc.proveedor_id = 5 AND pc.estado NOT IN ('borrador','cancelado') AND pc.fecha_pedido BETWEEN CURRENT_DATE - 364 AND CURRENT_DATE`);
    expect(p5.kpis.gasto_compras).toBeCloseTo(sql.g, 2);
    expect(p5.top_proveedores).toHaveLength(1);
    expect(p5.kpis.entregas_puntuales).toBeLessThan(total.entregas_puntuales); // el proveedor problemático de la simulación
  });

  it('filtra por producto, categoría y fechas de forma consistente', async () => {
    const total = (await get('/api/dashboard')).kpis;
    const prod = (await get('/api/dashboard?producto_id=1')).kpis;
    const [sql] = await q(`SELECT COALESCE(sum(stock), 0) * (SELECT coste_estandar FROM productos WHERE id = 1) AS v FROM v_existencias WHERE producto_id = 1`);
    expect(prod.valor_inventario).toBeCloseTo(sql.v, 2);
    expect(prod.gasto_compras).toBeGreaterThan(0);
    expect(prod.gasto_compras).toBeLessThan(total.gasto_compras);

    let porCategoria = 0;
    for (const c of await get('/api/inventario/categorias')) porCategoria += (await get(`/api/dashboard?categoria=${encodeURIComponent(c)}`)).kpis.consumo_valorado;
    expect(porCategoria).toBeCloseTo(total.consumo_valorado, 2);

    const hoy = new Date().toISOString().slice(0, 10);
    const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const mes = await get(`/api/dashboard?desde=${hace30}&hasta=${hoy}`);
    expect(mes.kpis.gasto_compras).toBeLessThan(total.gasto_compras);
    expect(mes.gasto_mensual.length).toBeLessThanOrEqual(2);
    expect((await request(app).get(`/api/dashboard?desde=${hoy}&hasta=${hace30}`).set(como('lectura'))).status).toBe(400);
  });

  it('los informes Gold aplican los mismos filtros que el panel', async () => {
    const panel = await get('/api/dashboard?proveedor_id=5');
    const gold = await get('/api/informes?proveedor_id=5');
    expect(gold.kpis.gasto_compras).toBeCloseTo(panel.kpis.gasto_compras, 2);
    expect(gold.kpis.entregas_puntuales).toBeCloseTo(panel.kpis.entregas_puntuales, 9);
    expect(gold.proveedores).toHaveLength(1);
    expect(gold.cuadre.al_dia).toBe(true); // el cuadre siempre se hace sin filtros
  });
});

describe('las operaciones cambian los resultados', () => {
  it('un pedido recibido cambia el panel al momento; los informes Gold solo tras ejecutar el pipeline', async () => {
    const antes = (await get('/api/dashboard')).kpis;
    const prodId = 1;
    const [{ stock: stockAntes }] = await q('SELECT COALESCE(sum(stock), 0) AS stock FROM v_existencias WHERE producto_id = $1', [prodId]);
    const entrega = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

    const pedido = (await request(app).post('/api/pedidos').set(como('compras'))
      .send({ proveedor_id: 1, almacen_id: 1, fecha_entrega_prevista: entrega, lineas: [{ producto_id: prodId, cantidad: 48, precio_unitario: 2 }] })).body;
    expect(pedido.estado).toBe('borrador');
    expect((await get('/api/dashboard')).kpis.gasto_compras).toBeCloseTo(antes.gasto_compras, 2); // un borrador no es gasto

    await request(app).post(`/api/pedidos/${pedido.id}/enviar`).set(como('compras'));
    const r = await request(app).post(`/api/pedidos/${pedido.id}/recepciones`).set(como('almacen'))
      .send({ albaran: 'ALB-TEST', lineas: [{ linea_pedido_id: pedido.lineas[0].id, cantidad_recibida: 48 }] });
    expect(r.body.estado).toBe('recibido');

    const despues = (await get('/api/dashboard')).kpis;
    expect(despues.gasto_compras).toBeCloseTo(antes.gasto_compras + 96, 2);
    expect(despues.pedidos).toBe(antes.pedidos + 1);
    const [{ stock: stockDespues, coste }] = await q('SELECT sum(e.stock) AS stock, max(p.coste_estandar) AS coste FROM v_existencias e JOIN productos p ON p.id = e.producto_id WHERE producto_id = $1', [prodId]);
    expect(stockDespues).toBe(stockAntes + 48);
    expect(despues.valor_inventario).toBeCloseTo(antes.valor_inventario + 48 * coste, 2);

    // Gold todavía es la foto anterior: el cuadre lo detecta.
    const desfasado = await get('/api/informes');
    expect(desfasado.cuadre.al_dia).toBe(false);
    expect(desfasado.kpis.gasto_compras).toBeCloseTo(antes.gasto_compras, 2);

    expect((await request(app).post('/api/datos/pipeline').set(como('lectura'))).status).toBe(403);
    const ejec = await request(app).post('/api/datos/pipeline').set(como('almacen'));
    expect(ejec.status).toBe(201);
    expect(ejec.body.bronze.tablas.find((t: any) => t.tabla === 'movimientos_stock').filas).toBe(1); // solo el movimiento nuevo

    const alDia = await get('/api/informes');
    expect(alDia.cuadre.al_dia).toBe(true);
    expect(alDia.kpis.gasto_compras).toBeCloseTo(despues.gasto_compras, 2);
  }, LARGO);

  it('una salida de stock reduce el inventario y aumenta el consumo', async () => {
    const antes = (await get('/api/dashboard')).kpis;
    const r = await request(app).post('/api/inventario/movimientos').set(como('almacen')).send({ producto_id: 1, almacen_id: 1, tipo: 'SALIDA_CONSUMO', cantidad: 10 });
    expect(r.status).toBe(201);
    const despues = (await get('/api/dashboard')).kpis;
    const [{ coste }] = await q('SELECT coste_estandar AS coste FROM productos WHERE id = 1');
    expect(despues.valor_inventario).toBeCloseTo(antes.valor_inventario - 10 * coste, 2);
    expect(despues.consumo_valorado).toBeCloseTo(antes.consumo_valorado + 10 * coste, 2);
  });
});

describe('calidad en Silver: cuarentena de datos defectuosos', () => {
  it('rechaza con su motivo los registros inválidos y normaliza los válidos', async () => {
    const b = rutas().bronze;
    const con = await conectarDuck();
    const ultimo = (t: string) => {
      const dir = path.join(b, t);
      const part = fs.readdirSync(dir).sort().pop()!;
      return posix(path.join(dir, part, fs.readdirSync(path.join(dir, part)).sort().pop()!));
    };
    const inyectar = async (tabla: string, reemplazos: string) => {
      const origen = ultimo(tabla); // antes de crear la carpeta del lote defectuoso
      const dir = path.join(b, tabla, 'fecha_carga=2999-01-01');
      fs.mkdirSync(dir, { recursive: true });
      await con.run(`COPY (SELECT * REPLACE (${reemplazos}, 'LOTE-DEFECTUOSO' AS _id_carga, now() AS _fecha_carga) FROM read_parquet('${origen}') LIMIT 1)
                     TO '${posix(path.join(dir, 'LOTE-DEFECTUOSO.parquet'))}' (FORMAT parquet)`);
    };
    // 1) Proveedor nuevo con CIF y estado inválidos.  2) Línea que apunta a un pedido inexistente.
    // 3) Salida con cantidad positiva (signo incoherente).  4) Versión más reciente de un producto con espacios sobrantes y SKU en minúsculas.
    await inyectar('proveedores', "CAST(9999 AS INTEGER) AS id, 'ZZ-MALO' AS codigo, 'x' AS cif, 'desconocido' AS estado");
    await inyectar('lineas_pedido', 'CAST(999999 AS INTEGER) AS id, CAST(888888 AS INTEGER) AS pedido_id');
    await inyectar('movimientos_stock', "CAST(99999999 AS BIGINT) AS id, 'SALIDA_CONSUMO' AS tipo, CAST(5 AS DECIMAL(14,3)) AS cantidad");
    const [{ sku }] = await q('SELECT sku FROM productos WHERE id = 1');
    await con.run(`CREATE TEMP TABLE prod1 AS SELECT * FROM read_parquet('${ultimo('productos')}') WHERE id = 1`);
    fs.mkdirSync(path.join(b, 'productos', 'fecha_carga=2999-01-01'), { recursive: true });
    await con.run(`COPY (SELECT * REPLACE ('   Agua    mineral   renombrada  ' AS nombre, lower(sku) AS sku, 'LOTE-DEFECTUOSO' AS _id_carga, now() AS _fecha_carga) FROM prod1)
                   TO '${posix(path.join(b, 'productos', 'fecha_carga=2999-01-01', 'LOTE-DEFECTUOSO.parquet'))}' (FORMAT parquet)`);

    const silver = await construirSilver(con, 'prueba-calidad');
    const porTabla = Object.fromEntries(silver.tablas.map((t: any) => [t.tabla, t]));
    expect(porTabla.proveedores.rechazadas).toBe(1);
    expect(porTabla.lineas_pedido.rechazadas).toBe(1);
    expect(porTabla.movimientos_stock.rechazadas).toBe(1);
    expect(porTabla.proveedores.escritas).toBe(9); // los válidos siguen intactos

    const motivo = (tabla: string) => silver.rechazos.find((r: any) => r.tabla === tabla)?.errores as string;
    expect(motivo('proveedores')).toContain('cif_formato');
    expect(motivo('proveedores')).toContain('estado_valido');
    expect(motivo('lineas_pedido')).toBe('referencia_pedido_id_inexistente');
    expect(motivo('movimientos_stock')).toBe('signo_coherente');

    // La cuarentena queda escrita en Parquet con el registro original, y la versión nueva del producto llega normalizada.
    const cuarentena = await filas(con, `SELECT tabla, registro FROM read_parquet('${posix(path.join(rutas().silver, 'calidad_rechazos.parquet'))}') ORDER BY tabla`);
    expect(cuarentena).toHaveLength(3);
    expect(JSON.parse(cuarentena.find((c) => c.tabla === 'proveedores')!.registro).codigo).toBe('ZZ-MALO');
    const p1 = await una(con, `SELECT nombre, sku FROM read_parquet('${posix(path.join(rutas().silver, 'productos.parquet'))}') WHERE id = 1`);
    expect(p1).toEqual({ nombre: 'Agua mineral renombrada', sku });

    // Gold se sigue construyendo con lo válido y mantiene la integridad referencial.
    const gold = await construirGold(con);
    expect(gold.tablas.find((t: any) => t.tabla === 'dim_proveedor').filas).toBe(9);
    con.closeSync?.();
  }, LARGO);
});

describe('restaurar la demo', () => {
  it('solo el administrador puede, y deja datos y lake como al principio', async () => {
    expect((await request(app).post('/api/datos/restaurar-demo').set(como('compras'))).status).toBe(403);
    const r = await request(app).post('/api/datos/restaurar-demo').set(como('admin'));
    expect(r.status).toBe(201);
    expect((await q(`SELECT count(*)::int AS n FROM recepciones WHERE albaran = 'ALB-TEST'`))[0].n).toBe(0);
    const e = ultimaEjecucion();
    expect(e.id_ejecucion).toBe(r.body.id_ejecucion);
    expect(e.silver.totales).toMatchObject({ rechazadas: 0, duplicadas_eliminadas: 0 }); // el lote defectuoso ha desaparecido con el lake
    expect((await get('/api/informes')).cuadre.al_dia).toBe(true);
    const estado = await get('/api/datos/estado');
    expect(estado.capas.gold.archivos).toBe(8);
    expect(estado.fabric.capacidad.estado).toBe('En pausa');
  }, LARGO);
});
