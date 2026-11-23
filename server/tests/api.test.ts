import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearApp } from '../src/app.js';
import { migrar } from '../src/db/migrate.js';
import { pool, q } from '../src/db/pool.js';

const app = crearApp();
const CLAVE = 'clave-de-prueba-123';
const tokens: Record<string, string> = {};
const como = (rol: string) => ({ Authorization: `Bearer ${tokens[rol]}` });
const enDias = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let proveedorId: number, almacenId: number, prodA: number, prodB: number;

beforeAll(async () => {
  expect((await q('SELECT current_database() AS db'))[0].db).toBe('businessflow_test'); // salvaguarda
  await migrar();
  // Cada archivo de pruebas parte de una base vacía: no depende del orden en que se ejecuten.
  await q(`TRUNCATE auditoria, movimientos_stock, lineas_recepcion, recepciones, lineas_pedido, pedidos_compra,
           productos, almacenes, proveedores, usuarios, empresas RESTART IDENTITY CASCADE`);
  const hash = await bcrypt.hash(CLAVE, 4);
  await q(`INSERT INTO empresas (nombre, cif) VALUES ('Empresa Test', 'B00000001'), ('Otra Empresa', 'B00000002')`);
  for (const rol of ['admin', 'compras', 'almacen', 'lectura']) {
    await q('INSERT INTO usuarios (empresa_id, email, nombre, password_hash, rol) VALUES (1,$1,$2,$3,$4)', [`${rol}@test.local`, rol, hash, rol]);
  }
  await q(`INSERT INTO usuarios (empresa_id, email, nombre, password_hash, rol) VALUES (2,'otra@test.local','otra',$1,'admin')`, [hash]);
  for (const rol of ['admin', 'compras', 'almacen', 'lectura', 'otra']) {
    const r = await request(app).post('/api/auth/login').send({ email: `${rol}@test.local`, password: CLAVE });
    tokens[rol] = r.body.token;
  }
  almacenId = (await q(`INSERT INTO almacenes (empresa_id, codigo, nombre) VALUES (1,'ALM-T','Almacén test') RETURNING id`))[0].id;
});

afterAll(() => pool.end());

describe('autenticación y acceso', () => {
  it('rechaza credenciales incorrectas y peticiones sin token', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'mala' })).status).toBe(401);
    expect((await request(app).get('/api/proveedores')).status).toBe(401);
    expect((await request(app).get('/api/proveedores').set({ Authorization: 'Bearer falso' })).status).toBe(401);
  });

  it('devuelve el perfil con un token válido', async () => {
    const r = await request(app).get('/api/auth/me').set(como('compras'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ rol: 'compras', empresa: 'Empresa Test' });
    expect(r.body.password_hash).toBeUndefined();
  });

  it('el rol de lectura no puede escribir y solo admin ve la auditoría', async () => {
    const r = await request(app).post('/api/proveedores').set(como('lectura')).send({});
    expect(r.status).toBe(403);
    expect((await request(app).get('/api/auditoria').set(como('compras'))).status).toBe(403);
    expect((await request(app).get('/api/auditoria').set(como('admin'))).status).toBe(200);
  });
});

describe('proveedores', () => {
  const valido = { codigo: 'PRV-T1', nombre: 'Proveedor Test', cif: 'B12345678', plazo_entrega_dias: 5, email: 'a@b.es' };

  it('valida los datos y devuelve errores por campo', async () => {
    const r = await request(app).post('/api/proveedores').set(como('compras')).send({ ...valido, codigo: 'con espacios', cif: 'x', plazo_entrega_dias: -1 });
    expect(r.status).toBe(400);
    expect(r.body.campos.map((c: any) => c.campo).sort()).toEqual(['cif', 'codigo', 'plazo_entrega_dias']);
  });

  it('crea, impide duplicados, modifica y deja rastro en auditoría', async () => {
    const r = await request(app).post('/api/proveedores').set(como('compras')).send(valido);
    expect(r.status).toBe(201);
    proveedorId = r.body.id;
    expect((await request(app).post('/api/proveedores').set(como('compras')).send(valido)).status).toBe(409);

    const m = await request(app).put(`/api/proveedores/${proveedorId}`).set(como('compras')).send({ ...valido, plazo_entrega_dias: 9 });
    expect(m.body.plazo_entrega_dias).toBe(9);
    const h = await request(app).get(`/api/proveedores/${proveedorId}/historial`).set(como('lectura'));
    expect(h.body.cambios[0].detalle.plazo_entrega_dias).toEqual({ antes: 5, despues: 9 });
  });

  it('aísla los datos entre empresas', async () => {
    expect((await request(app).get('/api/proveedores').set(como('otra'))).body).toHaveLength(0);
    expect((await request(app).get(`/api/proveedores/${proveedorId}`).set(como('otra'))).status).toBe(404);
  });
});

describe('ciclo de compra → recepción → stock', () => {
  let pedidoId: number, lineaA: number, lineaB: number;
  const stockDe = async (id: number) =>
    (await request(app).get('/api/inventario/productos').set(como('lectura'))).body.find((p: any) => p.id === id).stock;

  beforeAll(async () => {
    const crear = (sku: string) => request(app).post('/api/inventario/productos').set(como('compras'))
      .send({ sku, nombre: `Producto ${sku}`, categoria: 'Test', coste_estandar: 2, stock_minimo: 10, lote_compra: 5, proveedor_preferente_id: proveedorId });
    prodA = (await crear('T-A')).body.id;
    prodB = (await crear('T-B')).body.id;
  });

  it('rechaza pedidos sin líneas, con productos repetidos o con fecha pasada', async () => {
    const base = { proveedor_id: proveedorId, almacen_id: almacenId, fecha_entrega_prevista: enDias(5) };
    const linea = { producto_id: prodA, cantidad: 10, precio_unitario: 2 };
    expect((await request(app).post('/api/pedidos').set(como('compras')).send({ ...base, lineas: [] })).status).toBe(400);
    expect((await request(app).post('/api/pedidos').set(como('compras')).send({ ...base, lineas: [linea, linea] })).status).toBe(400);
    expect((await request(app).post('/api/pedidos').set(como('compras')).send({ ...base, fecha_entrega_prevista: enDias(-3), lineas: [linea] })).status).toBe(400);
    expect((await request(app).post('/api/pedidos').set(como('almacen')).send({ ...base, lineas: [linea] })).status).toBe(403);
  });

  it('crea el pedido en borrador con numeración correlativa', async () => {
    const r = await request(app).post('/api/pedidos').set(como('compras')).send({
      proveedor_id: proveedorId, almacen_id: almacenId, fecha_entrega_prevista: enDias(5),
      lineas: [{ producto_id: prodA, cantidad: 100, precio_unitario: 2.5 }, { producto_id: prodB, cantidad: 40, precio_unitario: 4 }],
    });
    expect(r.status).toBe(201);
    expect(r.body.numero).toMatch(/^PC-\d{4}-0001$/);
    expect(r.body).toMatchObject({ estado: 'borrador', importe: 410 });
    pedidoId = r.body.id;
    lineaA = r.body.lineas.find((l: any) => l.producto_id === prodA).id;
    lineaB = r.body.lineas.find((l: any) => l.producto_id === prodB).id;
  });

  it('no admite recepciones sobre un borrador', async () => {
    const r = await request(app).post(`/api/pedidos/${pedidoId}/recepciones`).set(como('almacen'))
      .send({ albaran: 'A-0', lineas: [{ linea_pedido_id: lineaA, cantidad_recibida: 1 }] });
    expect(r.status).toBe(409);
  });

  it('una recepción parcial genera entradas de stock y deja el pedido en "parcial"', async () => {
    expect((await request(app).post(`/api/pedidos/${pedidoId}/enviar`).set(como('compras'))).body.estado).toBe('enviado');
    const r = await request(app).post(`/api/pedidos/${pedidoId}/recepciones`).set(como('almacen')).send({
      albaran: 'A-1', lineas: [{ linea_pedido_id: lineaA, cantidad_recibida: 60, cantidad_rechazada: 5 }, { linea_pedido_id: lineaB, cantidad_recibida: 0 }],
    });
    expect(r.status).toBe(201);
    expect(r.body.estado).toBe('parcial');
    expect(r.body.lineas.find((l: any) => l.id === lineaA)).toMatchObject({ recibido: 60, rechazado: 5, pendiente: 40 });
    expect(await stockDe(prodA)).toBe(60); // lo rechazado no entra en stock
    expect(await stockDe(prodB)).toBe(0);
  });

  it('impide recibir más de lo pendiente y cancelar un pedido con mercancía recibida', async () => {
    const r = await request(app).post(`/api/pedidos/${pedidoId}/recepciones`).set(como('almacen'))
      .send({ albaran: 'A-X', lineas: [{ linea_pedido_id: lineaA, cantidad_recibida: 41 }] });
    expect(r.status).toBe(409);
    expect(await stockDe(prodA)).toBe(60); // la transacción se revirtió entera
    expect((await request(app).post(`/api/pedidos/${pedidoId}/cancelar`).set(como('compras'))).status).toBe(409);
  });

  it('al completar lo pendiente el pedido pasa a "recibido" y el movimiento lleva el precio de compra', async () => {
    const r = await request(app).post(`/api/pedidos/${pedidoId}/recepciones`).set(como('compras')).send({
      albaran: 'A-2', lineas: [{ linea_pedido_id: lineaA, cantidad_recibida: 40 }, { linea_pedido_id: lineaB, cantidad_recibida: 40 }],
    });
    expect(r.body.estado).toBe('recibido');
    expect(r.body.recepciones).toHaveLength(2);
    expect(await stockDe(prodA)).toBe(100);
    const m = await request(app).get(`/api/inventario/movimientos?producto_id=${prodB}`).set(como('lectura'));
    expect(m.body.filas[0]).toMatchObject({ tipo: 'ENTRADA_COMPRA', cantidad: 40, coste_unitario: 4 });
  });

  it('las salidas descuentan stock y nunca lo dejan en negativo', async () => {
    const salida = (cantidad: number) => request(app).post('/api/inventario/movimientos').set(como('almacen'))
      .send({ producto_id: prodA, almacen_id: almacenId, tipo: 'SALIDA_CONSUMO', cantidad });
    expect((await salida(30)).body.stock_resultante).toBe(70);
    expect((await salida(71)).status).toBe(409);
    expect((await salida(-5)).status).toBe(400);
    expect(await stockDe(prodA)).toBe(70);
  });

  it('dos salidas simultáneas no pueden vender el mismo stock', async () => {
    const salida = () => request(app).post('/api/inventario/movimientos').set(como('almacen'))
      .send({ producto_id: prodA, almacen_id: almacenId, tipo: 'SALIDA_CONSUMO', cantidad: 50 });
    const estados = (await Promise.all([salida(), salida()])).map((r) => r.status).sort();
    expect(estados).toEqual([201, 409]);
    expect(await stockDe(prodA)).toBe(20);
  });

  it('un ajuste exige motivo', async () => {
    const r = await request(app).post('/api/inventario/movimientos').set(como('almacen'))
      .send({ producto_id: prodA, almacen_id: almacenId, tipo: 'AJUSTE', cantidad: -2 });
    expect(r.status).toBe(400);
  });

  it('el panel y la reposición reflejan lo ocurrido', async () => {
    const d = (await request(app).get('/api/dashboard').set(como('lectura'))).body;
    expect(d.kpis.gasto_compras).toBe(410);
    expect(d.kpis.entregas_puntuales).toBe(1);
    expect(d.kpis.valor_inventario).toBe(20 * 2 + 40 * 2); // stock × coste estándar
    expect(d.kpis.productos_bajo_minimo).toBe(0);

    const rep = (await request(app).get('/api/inteligencia/reposicion').set(como('lectura'))).body;
    const a = rep.filas.find((f: any) => f.producto_id === prodA);
    expect(a.stock).toBe(20);
    expect(a.consumo_medio_diario).toBeCloseTo(80 / 90, 4); // 80 uds consumidas en una ventana de 90 días
    expect(a.cantidad_sugerida % 5).toBe(0);
  });
});
