/**
 * Extracción PostgreSQL → Parquet (zona de aterrizaje BRONZE).
 *
 * DuckDB hace de motor de extracción: se conecta a PostgreSQL en solo lectura y escribe Parquet (zstd)
 * sin pasar los datos por Node. La estructura de carpetas es la misma que tendrá en OneLake
 * (Files/bronze/<tabla>/fecha_carga=YYYY-MM-DD/<id_carga>.parquet), de modo que subirla a un Lakehouse
 * o sustituir este script por una actividad Copy de Data Factory no cambia nada aguas abajo.
 *
 * Trazabilidad: cada fila lleva _id_carga, _fecha_carga y _origen; cada ejecución deja un manifiesto JSON
 * con filas, hash SHA-256 y marca de agua por tabla, y se reconcilia contra el origen antes de darse por buena.
 *
 * Modos: tablas maestras y de pedidos → instantánea completa. movimientos_stock (libro solo-inserción)
 * → incremental por marca de agua sobre id. `--completa` fuerza recarga total.
 */
import { DuckDBInstance } from '@duckdb/node-api';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

interface Tabla { nombre: string; modo: 'completa' | 'incremental'; clave: string }
const TABLAS: Tabla[] = [
  { nombre: 'proveedores', modo: 'completa', clave: 'id' },
  { nombre: 'productos', modo: 'completa', clave: 'id' },
  { nombre: 'almacenes', modo: 'completa', clave: 'id' },
  { nombre: 'pedidos_compra', modo: 'completa', clave: 'id' },
  { nombre: 'lineas_pedido', modo: 'completa', clave: 'id' },
  { nombre: 'recepciones', modo: 'completa', clave: 'id' },
  { nombre: 'lineas_recepcion', modo: 'completa', clave: 'id' },
  { nombre: 'movimientos_stock', modo: 'incremental', clave: 'id' },
];

const sql = (s: string) => s.replace(/'/g, "''");
const posix = (p: string) => p.replace(/\\/g, '/');

export async function exportarBronze(opciones: { completa?: boolean; destino?: string } = {}) {
  const raizLake = opciones.destino ?? path.join(config.raiz, 'data', 'lake');
  const bronze = path.join(raizLake, 'Files', 'bronze');
  const rutaEstado = path.join(bronze, '_estado.json');
  const estado: Record<string, number> = !opciones.completa && fs.existsSync(rutaEstado) ? JSON.parse(fs.readFileSync(rutaEstado, 'utf8')) : {};

  const inicio = new Date();
  const idCarga = inicio.toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z'); // 20261123T165512Z
  const fechaCarga = inicio.toISOString().slice(0, 10);

  const db = await DuckDBInstance.create(':memory:');
  const con = await db.connect();
  await con.run('INSTALL postgres; LOAD postgres;');
  await con.run(
    `ATTACH 'host=${config.POSTGRES_HOST} port=${config.POSTGRES_PORT} user=${sql(config.POSTGRES_USER)} password=${sql(config.POSTGRES_PASSWORD)} dbname=${sql(config.POSTGRES_DB)}' AS origen (TYPE postgres, READ_ONLY)`);
  const uno = async (consulta: string) => (await con.runAndReadAll(consulta)).getRowObjects()[0] as Record<string, any>;

  const resultados: any[] = [];
  for (const t of TABLAS) {
    const t0 = Date.now();
    const desde = t.modo === 'incremental' ? (estado[t.nombre] ?? 0) : 0;
    const filtro = t.modo === 'incremental' ? `WHERE ${t.clave} > ${desde}` : '';
    const origen = await uno(`SELECT count(*)::BIGINT AS n, COALESCE(max(${t.clave}), ${desde})::BIGINT AS marca FROM origen.public.${t.nombre} ${filtro}`);
    const filas = Number(origen.n), marca = Number(origen.marca);

    if (filas === 0) {
      resultados.push({ tabla: t.nombre, modo: t.modo, filas: 0, archivo: null, nota: 'Sin filas nuevas desde la última carga' });
      continue;
    }
    const dir = path.join(bronze, t.nombre, `fecha_carga=${fechaCarga}`);
    fs.mkdirSync(dir, { recursive: true });
    const archivo = path.join(dir, `${idCarga}.parquet`);
    // Se acota por la marca leída arriba: si entran filas durante la extracción, quedan para la carga siguiente.
    const acotado = t.modo === 'incremental' ? `WHERE ${t.clave} > ${desde} AND ${t.clave} <= ${marca}` : '';
    await con.run(
      `COPY (SELECT *, '${idCarga}' AS _id_carga, TIMESTAMPTZ '${inicio.toISOString()}' AS _fecha_carga,
                    'postgresql://${sql(config.POSTGRES_DB)}/public.${t.nombre}' AS _origen
               FROM origen.public.${t.nombre} ${acotado} ORDER BY ${t.clave})
       TO '${sql(posix(archivo))}' (FORMAT parquet, COMPRESSION zstd)`);

    // Reconciliación: lo escrito debe coincidir con lo leído en origen.
    const escrito = await uno(`SELECT count(*)::BIGINT AS n, count(DISTINCT ${t.clave})::BIGINT AS claves FROM read_parquet('${sql(posix(archivo))}')`);
    const ok = t.modo === 'incremental' ? Number(escrito.n) === filas : Number(escrito.n) >= filas; // completa: puede haber crecido entre el recuento y la copia
    if (!ok || Number(escrito.claves) !== Number(escrito.n)) {
      fs.rmSync(archivo);
      throw new Error(`Reconciliación fallida en ${t.nombre}: origen=${filas}, parquet=${escrito.n}, claves=${escrito.claves}`);
    }
    if (t.modo === 'incremental') estado[t.nombre] = marca;
    resultados.push({
      tabla: t.nombre, modo: t.modo, filas: Number(escrito.n),
      marca_agua: t.modo === 'incremental' ? { desde, hasta: marca } : null,
      archivo: posix(path.relative(raizLake, archivo)), bytes: fs.statSync(archivo).size,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(archivo)).digest('hex'), ms: Date.now() - t0,
    });
  }
  con.closeSync?.();

  const manifiesto = {
    id_carga: idCarga, inicio: inicio.toISOString(), fin: new Date().toISOString(),
    origen: `postgresql://${config.POSTGRES_HOST}:${config.POSTGRES_PORT}/${config.POSTGRES_DB}`,
    motor: 'duckdb', estado: 'correcta', total_filas: resultados.reduce((s, r) => s + r.filas, 0), tablas: resultados,
  };
  const dirMan = path.join(bronze, '_manifiestos');
  fs.mkdirSync(dirMan, { recursive: true });
  fs.writeFileSync(path.join(dirMan, `${idCarga}.json`), JSON.stringify(manifiesto, null, 2));
  fs.writeFileSync(rutaEstado, JSON.stringify(estado, null, 2));
  return manifiesto;
}

if (process.argv[1]?.endsWith('exportBronze.ts')) {
  exportarBronze({ completa: process.argv.includes('--completa') })
    .then((m) => {
      console.log(`Carga ${m.id_carga}: ${m.total_filas} filas`);
      console.table(m.tablas.map((t: any) => ({ tabla: t.tabla, modo: t.modo, filas: t.filas, KB: t.bytes ? Math.round(t.bytes / 1024) : 0, marca: t.marca_agua ? `${t.marca_agua.desde}→${t.marca_agua.hasta}` : '' })));
      process.exit(0);
    })
    .catch((e) => { console.error('Carga fallida:', e.message); process.exit(1); });
}
