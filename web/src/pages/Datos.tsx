import { ArrowDown, ArrowRight, Check, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BotonPipeline, EstadoPipeline, RestaurarDemo, usePipeline } from '../components/Operaciones';
import { Cabecera, Carga, cx, Esqueleto, Insignia, Panel, Tabla, Td, Th, TituloPanel, Vacio } from '../components/ui';
import { api, useDatos, type EstadoDatos, type EvidenciasFabric } from '../lib/api';
import { eur, fecha, fechaHora, num, pct } from '../lib/format';

const bytes = (b: number) => (b >= 1048576 ? `${num(b / 1048576, 1)} MB` : `${num(b / 1024)} kB`);
const segundos = (ms: number | null | undefined) => (ms == null ? '—' : `${num(ms / 1000, 1)} s`);
const legible = (s: string) => s.replaceAll('_', ' ');
/** La marca de agua llega como valor suelto o como intervalo { desde, hasta }: se muestra tal cual, sin suponer su forma. */
function marca(m: unknown): string {
  if (m === null || m === undefined || m === '') return '—';
  if (typeof m !== 'object') return String(m);
  const o = m as Record<string, unknown>;
  const v = (x: unknown) => (x === null || x === undefined ? 'inicio' : typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(x) ? fechaHora(x) : String(x));
  return 'desde' in o || 'hasta' in o ? `${v(o.desde)} → ${v(o.hasta)}` : Object.entries(o).map(([k, x]) => `${legible(k)}: ${v(x)}`).join(', ');
}

interface Etapa { nombre: string; tecnologia: string; hace: string; cifras: [string, string][]; tono: string }

function Circuito({ e }: { e: EstadoDatos }) {
  const u = e.ultima;
  const filasGold = u?.gold.tablas.reduce((s, t) => s + t.filas, 0);
  const etapas: Etapa[] = [
    { nombre: 'Base operativa', tecnologia: 'PostgreSQL', tono: 'bg-tenue', hace: 'Donde trabaja la aplicación: pedidos, recepciones y movimientos se guardan aquí al momento.',
      cifras: [['Tablas de origen', u ? num(u.bronze.tablas.length) : '—'], ['Filas extraídas en la última carga', u ? num(u.bronze.total_filas) : '—']] },
    { nombre: 'Bronze', tecnologia: 'Parquet original por carga', tono: 'bg-ambar', hace: 'Copia fiel de lo extraído, sin tocar. Cada carga añade archivos nuevos y deja rastro de cuándo y qué se cargó.',
      cifras: [['Archivos Parquet', num(e.capas.bronze.archivos)], ['Tamaño', bytes(e.capas.bronze.bytes)]] },
    { nombre: 'Silver', tecnologia: 'Limpio y validado', tono: 'bg-marca', hace: 'Elimina duplicados entre cargas, valida formatos y referencias, y aparta las filas que incumplen una regla.',
      cifras: [['Filas válidas', u ? num(u.silver.totales.escritas) : '—'], ['Duplicadas eliminadas', u ? num(u.silver.totales.duplicadas_eliminadas) : '—'], ['Rechazadas', u ? num(u.silver.totales.rechazadas) : '—']] },
    { nombre: 'Gold', tecnologia: 'Modelo en estrella', tono: 'bg-verde', hace: 'Dimensiones y hechos con granularidad definida, listos para sumar, filtrar y comparar.',
      cifras: [['Tablas', u ? num(u.gold.tablas.length) : '—'], ['Filas', filasGold === undefined ? '—' : num(filasGold)], ['Tamaño', bytes(e.capas.gold.bytes)]] },
    { nombre: 'Indicadores e informes', tecnologia: 'Consultas sobre Gold', tono: 'bg-tinta', hace: 'Las medidas de la página Informes se calculan sobre Gold y se cuadran contra la base operativa.',
      cifras: [['Última ejecución', u ? fechaHora(u.fin) : 'Nunca'], ['Duración', segundos(u?.duracion_ms.total)]] },
  ];
  return (
    <ol className="flex flex-col gap-1 xl:flex-row xl:items-stretch">
      {etapas.map((x, i) => (
        <li key={x.nombre} className="flex min-w-0 flex-1 flex-col gap-1 xl:flex-row xl:items-stretch">
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-linea bg-panel">
            <div className={cx('h-1', x.tono)} aria-hidden />
            <div className="flex flex-1 flex-col px-3.5 py-3">
              <h3 className="titulo text-base leading-tight">{x.nombre}</h3>
              <p className="text-xs text-tenue">{x.tecnologia}</p>
              <p className="mt-2 flex-1 text-[13px] text-tenue">{x.hace}</p>
              <dl className="mt-3 space-y-0.5 border-t border-linea/70 pt-2 text-[13px]">
                {x.cifras.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-tenue">{k}</dt><dd className="cifra shrink-0 font-medium">{v}</dd></div>)}
              </dl>
              {i === 4 && <Link to="/informes" className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-marca hover:underline">Abrir informes<ArrowRight size={14} /></Link>}
            </div>
          </div>
          {i < etapas.length - 1 && (
            <div className="flex shrink-0 items-center justify-center text-tenue" aria-hidden>
              <ArrowDown size={16} className="xl:hidden" /><ArrowRight size={16} className="hidden xl:block" />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

const Subtitulo = ({ children }: { children: ReactNode }) => <h2 className="titulo mt-8 mb-1 text-xl">{children}</h2>;

export function Datos() {
  const r = useDatos((s) => api.get<EstadoDatos>('/datos/estado', undefined, s), []);
  const pipeline = usePipeline(() => r.recargar());

  return (
    <>
      <Cabecera titulo="Circuito de datos"
        descripcion="Cómo llegan las operaciones del día a día a los informes: una arquitectura medallion que se ejecuta entera en este equipo."
        acciones={<><RestaurarDemo /><BotonPipeline p={pipeline} /></>} />
      <EstadoPipeline p={pipeline} className="mb-4" />
      {r.datos?.en_curso && !pipeline.enCurso && <p role="status" className="mb-4 rounded-md bg-ambar-suave px-3 py-2 text-ambar">Hay una operación en curso en el servidor: {r.datos.en_curso}.</p>}

      <Carga r={r} esqueleto={<div className="space-y-4" role="status" aria-label="Cargando el estado del circuito"><Esqueleto className="h-56 w-full" /><Esqueleto className="h-72 w-full" /></div>}>
        {(e) => (
          <>
            <Circuito e={e} />
            {!e.ultima ? (
              <Panel className="mt-4"><Vacio titulo="El pipeline no se ha ejecutado todavía" texto="Ejecútalo para extraer la base operativa a Bronze, limpiarla en Silver y construir el modelo Gold." accion={<BotonPipeline p={pipeline} />} /></Panel>
            ) : <UltimaEjecucion e={e} />}
            {e.fabric && <Fabric f={e.fabric} />}
          </>
        )}
      </Carga>
    </>
  );
}

function UltimaEjecucion({ e }: { e: EstadoDatos }) {
  const u = e.ultima!;
  const c = u.gold.controles ?? {};
  const huerfanas = Object.entries(c).filter(([k]) => k.startsWith('huerfanas_'));
  const totalHuerfanas = huerfanas.reduce((s, [, v]) => s + v, 0);
  const pares: [string, string, string, (n: number) => string][] = [
    ['Importe de compras', 'silver_importe', 'gold_importe', eur], ['Stock total (unidades)', 'silver_stock', 'gold_stock', (n) => num(n)],
    ['Unidades recibidas', 'gold_recibido_en_compras', 'gold_recibido', (n) => num(n)],
  ];
  const rechazos = Array.isArray(u.silver.rechazos) ? (u.silver.rechazos as Record<string, unknown>[]) : Object.entries((u.silver.rechazos ?? {}) as Record<string, unknown>).map(([k, v]) => ({ tabla: k, detalle: v }));

  return (
    <>
      <Subtitulo>Última ejecución</Subtitulo>
      <p className="mb-3 text-tenue">
        <span className="cifra text-tinta">{u.id_ejecucion}</span>, terminada el {fechaHora(u.fin)} con el motor {u.motor}.{' '}
        Bronze {segundos(u.duracion_ms.bronze)}, Silver {segundos(u.duracion_ms.silver)}, Gold {segundos(u.duracion_ms.gold)}.
      </p>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <TituloPanel extra={<span className="cifra text-[13px] text-tenue">{num(u.bronze.total_filas)} filas, carga {u.bronze.id_carga}</span>}>Bronze: extracción</TituloPanel>
          <Tabla minimo={480}>
            <thead><tr><Th>Tabla</Th><Th>Modo</Th><Th der>Filas</Th><Th der>Marca de agua</Th></tr></thead>
            <tbody>
              {u.bronze.tablas.map((t) => (
                <tr key={t.tabla}>
                  <Td className="cifra">{t.tabla}</Td>
                  <Td><Insignia tono={t.modo === 'incremental' ? 'marca' : 'neutro'}>{t.modo === 'incremental' ? 'Incremental' : 'Completa'}</Insignia></Td>
                  <Td der>{num(t.filas)}</Td>
                  <Td der className="text-tenue">{marca(t.marca_agua)}</Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
          <p className="px-4 py-2.5 text-xs text-tenue">Completa: se vuelve a extraer la tabla entera. Incremental: solo las filas posteriores a la marca de agua de la carga anterior.</p>
        </Panel>

        <Panel>
          <TituloPanel extra={<span className="cifra text-[13px] text-tenue">{num(u.silver.totales.rechazadas)} rechazadas</span>}>Silver: limpieza y validación</TituloPanel>
          <Tabla minimo={600}>
            <thead><tr><Th>Tabla</Th><Th der>Cargas leídas</Th><Th der>Filas leídas</Th><Th der>Duplicadas</Th><Th der>Rechazadas</Th><Th der>Escritas</Th></tr></thead>
            <tbody>
              {u.silver.tablas.map((t) => (
                <tr key={t.tabla}>
                  <Td className="cifra">{t.tabla}</Td><Td der>{num(t.cargas_leidas)}</Td><Td der>{num(t.filas_leidas)}</Td>
                  <Td der className={t.duplicadas_eliminadas ? '' : 'text-tenue'}>{num(t.duplicadas_eliminadas)}</Td>
                  <Td der className={t.rechazadas ? 'font-medium text-rojo' : 'text-tenue'}>{num(t.rechazadas)}</Td>
                  <Td der className="font-medium">{num(t.escritas)}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="bg-panel2 font-medium"><Td>Total</Td><Td /><Td der>{num(u.silver.totales.filas_leidas)}</Td><Td der>{num(u.silver.totales.duplicadas_eliminadas)}</Td><Td der>{num(u.silver.totales.rechazadas)}</Td><Td der>{num(u.silver.totales.escritas)}</Td></tr></tfoot>
          </Tabla>
          <p className="px-4 py-2.5 text-xs text-tenue">Las duplicadas aparecen porque Bronze conserva todas las cargas: Silver se queda con la versión más reciente de cada registro.</p>
        </Panel>

        <Panel>
          <TituloPanel>Gold: modelo dimensional</TituloPanel>
          <Tabla minimo={480}>
            <thead><tr><Th>Tabla</Th><Th>Granularidad: una fila por…</Th><Th der>Filas</Th></tr></thead>
            <tbody>
              {e.modelo_gold.map((m) => {
                const t = u.gold.tablas.find((x) => x.tabla === m.tabla);
                return (
                  <tr key={m.tabla}>
                    <Td><span className="cifra">{m.tabla}</span> <Insignia tono={m.tabla.startsWith('dim_') ? 'neutro' : 'marca'}>{m.tabla.startsWith('dim_') ? 'Dimensión' : m.tabla.startsWith('fact_') ? 'Hechos' : 'Foto periódica'}</Insignia></Td>
                    <Td>{m.grano}</Td>
                    <Td der>{t ? num(t.filas) : <span className="text-tenue">—</span>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Tabla>
        </Panel>

        <Panel>
          <TituloPanel>Controles tras construir Gold</TituloPanel>
          <ul className="divide-y divide-linea/70">
            <li className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span>Claves sin dimensión en las tablas de hechos <span className="text-tenue">({huerfanas.length} comprobaciones)</span></span>
              <span className={cx('cifra inline-flex shrink-0 items-center gap-1 font-medium', totalHuerfanas === 0 ? 'text-verde' : 'text-rojo')}>{totalHuerfanas === 0 ? <Check size={15} aria-hidden /> : <X size={15} aria-hidden />}{num(totalHuerfanas)}</span>
            </li>
            {pares.filter(([, a, b]) => a in c && b in c).map(([nombre, a, b, fmt]) => {
              const ok = Math.abs(c[a] - c[b]) < 0.005;
              return (
                <li key={nombre} className="flex flex-wrap items-center justify-between gap-x-3 px-4 py-2.5">
                  <span>{nombre}</span>
                  <span className={cx('cifra inline-flex shrink-0 items-center gap-1', ok ? 'text-verde' : 'text-rojo')}>{ok ? <Check size={15} aria-hidden /> : <X size={15} aria-hidden />}<span className="text-tinta">{fmt(c[a])}</span><span className="text-tenue">= {fmt(c[b])}</span></span>
                </li>
              );
            })}
          </ul>
          <p className="px-4 py-2.5 text-xs text-tenue">Cada total se calcula dos veces por caminos distintos (Silver y Gold, o dos tablas de hechos) y debe dar lo mismo.</p>
        </Panel>
      </div>

      <Panel className="mt-4">
        <TituloPanel extra={<span className="text-[13px] text-tenue">Lo que una fila debe cumplir para pasar a Silver</span>}>Reglas de calidad</TituloPanel>
        <div className="grid gap-px bg-linea/70 sm:grid-cols-2 xl:grid-cols-4">
          {e.reglas_silver.map((t) => (
            <div key={t.tabla} className="bg-panel px-4 py-3">
              <h3 className="cifra font-medium">{t.tabla}</h3>
              <ul className="mt-1.5 space-y-0.5 text-[13px] text-tenue">
                {t.reglas.map((x) => <li key={x} className="first-letter:uppercase">{legible(x)}</li>)}
                {t.referencias.map((x) => <li key={x} className="cifra text-tinta">{x}</li>)}
                {t.reglas.length + t.referencias.length === 0 && <li>Sin reglas propias</li>}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-linea px-4 py-3">
          <h3 className="font-medium">Filas rechazadas en la última ejecución</h3>
          {u.silver.totales.rechazadas === 0 || rechazos.length === 0
            ? <p className="text-[13px] text-tenue">Ninguna: todas las filas leídas cumplían las reglas. {u.silver.totales.rechazadas > 0 && 'El detalle no está disponible.'}</p>
            : <ul className="cifra mt-1 space-y-0.5 text-[13px]">{rechazos.slice(0, 30).map((x, i) => <li key={i} className="break-words text-rojo">{Object.entries(x).map(([k, v]) => `${legible(k)}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('; ')}</li>)}</ul>}
        </div>
      </Panel>

      <Panel className="mt-4">
        <TituloPanel>Historial de ejecuciones</TituloPanel>
        <Tabla minimo={680}>
          <thead><tr><Th>Ejecución</Th><Th>Terminada</Th><Th der>Duración</Th><Th der>Filas a Bronze</Th><Th der>Duplicadas</Th><Th der>Rechazadas</Th><Th der>Escritas en Silver</Th></tr></thead>
          <tbody>
            {e.historial.map((h, i) => (
              <tr key={h.id_ejecucion}>
                <Td><span className="cifra">{h.id_ejecucion}</span>{i === 0 && <span className="ml-2"><Insignia tono="verde">Vigente</Insignia></span>}</Td>
                <Td className="cifra whitespace-nowrap">{fechaHora(h.fin)}</Td><Td der>{segundos(h.duracion_ms)}</Td><Td der>{num(h.filas_bronze)}</Td>
                <Td der>{num(h.duplicadas)}</Td><Td der className={h.rechazadas ? 'text-rojo' : ''}>{num(h.rechazadas)}</Td><Td der>{num(h.escritas_silver)}</Td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      </Panel>
    </>
  );
}

const COMPARATIVA: [string, string, string][] = [
  ['Almacenamiento', 'OneLake: Lakehouse lh_businessflow (Files/bronze, Tables/silver, Tables/gold)', 'Carpeta local data/lake con la misma estructura bronze, silver y gold'],
  ['Formato', 'Parquet en Bronze, tablas Delta en Silver y Gold', 'Parquet en las tres capas'],
  ['Transformación', 'Notebooks PySpark (01_bronze_a_silver, 02_silver_a_gold)', 'DuckDB con las mismas reglas y el mismo modelo'],
  ['Consultas analíticas', 'Warehouse wh_businessflow: vistas y procedimiento T-SQL', 'Las mismas consultas en SQL de DuckDB'],
  ['Medidas', 'Modelo semántico Direct Lake con 30 medidas DAX', 'Consultas SQL equivalentes, una por medida'],
  ['Visualización', 'Power BI sobre el modelo semántico (informe no construido)', 'Gráficos de esta aplicación (Panel e Informes)'],
  ['Orquestación', 'Notebooks lanzados por API (sin canalización de Data Factory)', 'Botón «Ejecutar pipeline» de esta página'],
];

function Fabric({ f }: { f: EvidenciasFabric }) {
  const fmt = (medida: string, v: number) => (medida.startsWith('%') ? pct(v, 2) : /Coste|Valor|Consumo/.test(medida) ? eur(v) : Number.isInteger(v) ? num(v) : num(v, 4));
  return (
    <section aria-labelledby="titulo-fabric">
      <h2 id="titulo-fabric" className="titulo mt-10 mb-2 text-xl">Microsoft Fabric</h2>
      <div className="mb-4 rounded-lg border border-linea bg-panel px-4 py-3 shadow-[inset_3px_0_0_var(--ambar)]">
        <p className="font-medium">Ejecutado y validado en Fabric el {fecha(f.fecha)}. Capacidad actualmente en pausa. Esta demo no se conecta a Azure.</p>
        <p className="mt-1 max-w-[100ch] text-[13px] text-tenue">
          Lo que sigue es un registro guardado de aquella ejecución, no datos en vivo. Capacidad {f.capacidad.nombre} ({f.capacidad.sku}, {f.capacidad.region}, {f.capacidad.suscripcion}),
          encendida de {f.capacidad.encendida}; estado «{f.capacidad.estado}» comprobado el {f.capacidad.estado_verificado}.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <TituloPanel>Recursos creados</TituloPanel>
          <ul className="divide-y divide-linea/70">
            {f.recursos.map((x) => (
              <li key={x.nombre} className="px-4 py-2.5">
                <p><span className="text-tenue">{x.tipo}:</span> <span className="cifra font-medium">{x.nombre}</span></p>
                {x.detalle && <p className="text-[13px] text-tenue">{x.detalle}</p>}
              </li>
            ))}
            <li className="px-4 py-2.5"><p><span className="text-tenue">Bronze:</span> <span className="font-medium">{num(f.bronze.archivos_subidos)} archivos Parquet ({bytes(f.bronze.bytes)})</span></p><p className="text-[13px] text-tenue">{f.bronze.destino}</p></li>
          </ul>
        </Panel>

        <Panel>
          <TituloPanel extra={<span className="text-[13px] text-tenue">Aplicación frente a modelo semántico</span>}>Validación de medidas DAX</TituloPanel>
          <Tabla minimo={460}>
            <thead><tr><Th>Medida</Th><Th der>Aplicación</Th><Th der>Fabric (DAX)</Th><Th /></tr></thead>
            <tbody>
              {f.validacion_dax.map((v) => {
                const ok = Math.abs(v.aplicacion - v.fabric) < 1e-6;
                return (
                  <tr key={v.medida}>
                    <Td>{v.medida}</Td><Td der>{fmt(v.medida, v.aplicacion)}</Td><Td der>{fmt(v.medida, v.fabric)}</Td>
                    <Td der>{ok ? <Check size={15} className="inline text-verde" aria-label="Coincide" /> : <X size={15} className="inline text-rojo" aria-label="No coincide" />}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Tabla>
          <p className="px-4 py-2.5 text-xs text-tenue">Valores del {fecha(f.fecha)}, con los datos que había entonces. No tienen por qué coincidir con los de hoy.</p>
        </Panel>

        <Panel>
          <TituloPanel extra={<span className="cifra text-[13px] text-tenue">Notebook PySpark, {num(f.silver.segundos)} s</span>}>Silver en Fabric</TituloPanel>
          <Tabla minimo={520}>
            <thead><tr><Th>Tabla</Th><Th der>Cargas</Th><Th der>Leídas</Th><Th der>Duplicadas</Th><Th der>Rechazadas</Th><Th der>Escritas</Th></tr></thead>
            <tbody>
              {f.silver.tablas.map((t) => (
                <tr key={t.tabla}><Td className="cifra">{t.tabla}</Td><Td der>{num(t.cargas_leidas)}</Td><Td der>{num(t.filas_leidas)}</Td><Td der>{num(t.duplicadas_eliminadas)}</Td><Td der>{num(t.rechazadas)}</Td><Td der className="font-medium">{num(t.escritas)}</Td></tr>
              ))}
            </tbody>
            <tfoot><tr className="bg-panel2 font-medium"><Td>Total</Td><Td /><Td der>{num(f.silver.totales.filas_leidas)}</Td><Td der>{num(f.silver.totales.duplicadas_eliminadas)}</Td><Td der>{num(f.silver.totales.rechazadas)}</Td><Td der>{num(f.silver.totales.escritas)}</Td></tr></tfoot>
          </Tabla>
        </Panel>

        <div className="space-y-4">
          <Panel>
            <TituloPanel extra={<span className="cifra text-[13px] text-tenue">Notebook PySpark, {num(f.gold.segundos)} s</span>}>Gold en Fabric</TituloPanel>
            <ul className="grid grid-cols-1 gap-px bg-linea/70 sm:grid-cols-2">
              {f.gold.tablas.map((t) => <li key={t.tabla} className="flex justify-between gap-3 bg-panel px-4 py-2"><span className="cifra truncate">{t.tabla}</span><span className="cifra shrink-0 font-medium">{num(t.filas)}</span></li>)}
            </ul>
          </Panel>
          <Panel>
            <TituloPanel>Objetos del Warehouse</TituloPanel>
            <ul className="divide-y divide-linea/70">
              {f.warehouse.map((o) => (
                <li key={o.objeto} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-2">
                  <span className="cifra">{o.objeto}</span><span className="text-[13px] text-tenue capitalize">{o.tipo}</span>
                  {o.detalle && <span className="w-full text-[13px] text-tenue">{o.detalle}</span>}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel>
          <TituloPanel>No demostrado en Fabric</TituloPanel>
          <ul className="divide-y divide-linea/70">
            {f.no_demostrado_en_fabric.map((x) => <li key={x} className="flex gap-2.5 px-4 py-2.5"><X size={15} className="mt-0.5 shrink-0 text-tenue" aria-hidden /><span>{x}</span></li>)}
          </ul>
        </Panel>
        <Panel>
          <TituloPanel>Incidencias durante la ejecución</TituloPanel>
          <ul className="divide-y divide-linea/70">
            {f.incidencias.map((x) => <li key={x} className="px-4 py-2.5 text-tenue">{x}</li>)}
          </ul>
        </Panel>
      </div>

      <Panel className="mt-4">
        <TituloPanel>En Fabric y en esta demo local</TituloPanel>
        <Tabla minimo={720}>
          <thead><tr><Th>Etapa</Th><Th>En Fabric</Th><Th>En esta demo local</Th></tr></thead>
          <tbody>
            {COMPARATIVA.map(([etapa, fab, local]) => <tr key={etapa}><Td className="font-medium whitespace-nowrap">{etapa}</Td><Td>{fab}</Td><Td>{local}</Td></tr>)}
          </tbody>
        </Tabla>
      </Panel>
    </section>
  );
}
