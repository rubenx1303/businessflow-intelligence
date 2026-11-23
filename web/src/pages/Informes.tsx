import { Check, RotateCcw, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Barra, CajaTooltip, claseTono, tonoOtd } from '../components/graficos';
import { BotonPipeline, EstadoPipeline, usePipeline } from '../components/Operaciones';
import { Boton, Cabecera, Carga, cx, Entrada, Esqueleto, Filtro, Insignia, Panel, Selector, Tabla, Td, Th, TONO_PROVEEDOR, Vacio } from '../components/ui';
import { api, useDatos, type Informes as Datos, type LineaCuadre, type Proveedor, type RespuestaInformes } from '../lib/api';
import { useFiltrosUrl } from '../lib/filtros';
import { ETIQUETA_ESTADO_PROVEEDOR, eur, eur0, eurK, fecha, fechaHora, mes, num, pct, pctSigno } from '../lib/format';

const CLAVES = ['desde', 'hasta', 'proveedor', 'categoria'] as const;

/** Cabecera de sección con su equivalente en Fabric: la medida DAX y/o la vista T-SQL que calcula lo mismo. */
function Seccion({ titulo, dax, sql, nota, children }: { titulo: string; dax?: string[]; sql?: string; nota?: string; children: ReactNode }) {
  return (
    <Panel>
      <div className="border-b border-linea px-4 py-2.5">
        <h2 className="titulo text-[15px]">{titulo}</h2>
        <p className="mt-0.5 text-xs text-tenue">
          Equivalente en Fabric:{' '}
          {dax && <>{dax.length === 1 ? 'medida DAX' : 'medidas DAX'} {dax.map((m, i) => <span key={m}>{i > 0 && ', '}<span className="text-tinta">«{m}»</span></span>)}</>}
          {dax && sql && '; '}
          {sql && <>T-SQL <code className="cifra text-tinta">{sql}</code></>}
          {nota && <>. {nota}</>}
        </p>
      </div>
      {children}
    </Panel>
  );
}

function valorCuadre(l: LineaCuadre, v: number | null): string {
  if (v === null) return '—';
  if (['gasto_compras', 'valor_inventario', 'consumo_valorado'].includes(l.campo)) return eur(v);
  if (l.campo === 'entregas_puntuales') return pct(v, 2);
  if (l.campo === 'pedidos' || l.campo === 'productos_bajo_minimo') return num(v);
  return num(v, 4);
}

export function Informes() {
  const { f, cambiar, limpiar, activos } = useFiltrosUrl(CLAVES);
  const r = useDatos((s) => api.get<RespuestaInformes>('/informes', { desde: f.desde, hasta: f.hasta, proveedor_id: f.proveedor, categoria: f.categoria }, s), [f.desde, f.hasta, f.proveedor, f.categoria]);
  const proveedores = useDatos((s) => api.get<Proveedor[]>('/proveedores', undefined, s), []);
  const categorias = useDatos((s) => api.get<string[]>('/inventario/categorias', undefined, s), []);
  const pipeline = usePipeline(() => r.recargar());
  const d = r.datos?.disponible ? r.datos : null;

  return (
    <>
      <Cabecera titulo="Informes"
        descripcion={d ? `Calculado sobre la capa Gold, ejecución ${d.ejecucion.id_ejecucion ?? 'desconocida'} del ${fechaHora(d.ejecucion.fin)}. No cambia hasta que se vuelve a ejecutar el pipeline.` : 'Medidas del modelo dimensional calculadas sobre la capa Gold del circuito de datos.'}
        acciones={<BotonPipeline p={pipeline} variante="secundario" />} />
      <EstadoPipeline p={pipeline} className="mb-4" />

      <div className="mb-4 grid grid-cols-2 gap-2 lg:flex lg:flex-wrap lg:items-center">
        <Filtro etiqueta="Desde">{(id) => <Entrada id={id} type="date" value={f.desde} max={f.hasta || undefined} onChange={(e) => cambiar({ desde: e.target.value })} className="lg:w-40" />}</Filtro>
        <Filtro etiqueta="Hasta">{(id) => <Entrada id={id} type="date" value={f.hasta} min={f.desde || undefined} onChange={(e) => cambiar({ hasta: e.target.value })} className="lg:w-40" />}</Filtro>
        <Filtro etiqueta="Proveedor">{(id) => (
          <Selector id={id} value={f.proveedor} onChange={(e) => cambiar({ proveedor: e.target.value })} className="lg:w-56">
            <option value="">Todos los proveedores</option>{proveedores.datos?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </Selector>)}</Filtro>
        <Filtro etiqueta="Categoría">{(id) => (
          <Selector id={id} value={f.categoria} onChange={(e) => cambiar({ categoria: e.target.value })} className="lg:w-52">
            <option value="">Todas las categorías</option>{categorias.datos?.map((c) => <option key={c}>{c}</option>)}
          </Selector>)}</Filtro>
        {activos && <Boton variante="fantasma" className="col-span-2" onClick={limpiar}><RotateCcw size={15} />Limpiar filtros</Boton>}
      </div>

      <Carga r={r} esqueleto={<div className="space-y-4" role="status" aria-label="Cargando informes"><Esqueleto className="h-40 w-full" /><Esqueleto className="h-24 w-full" /><Esqueleto className="h-72 w-full" /></div>}>
        {(resp) => !resp.disponible
          ? <Panel><Vacio titulo="Todavía no hay capa Gold" texto="Los informes se calculan sobre el modelo dimensional. Ejecuta el pipeline para construir Bronze, Silver y Gold a partir de la base operativa."
              accion={<div className="flex flex-col items-center gap-2"><BotonPipeline p={pipeline} /><Link to="/datos" className="text-[13px] font-medium text-marca hover:underline">Ver el circuito de datos</Link></div>} /></Panel>
          : <Contenido d={resp} pipeline={pipeline} filtrado={activos} />}
      </Carga>
    </>
  );
}

function Contenido({ d, pipeline, filtrado }: { d: Datos; pipeline: ReturnType<typeof usePipeline>; filtrado: boolean }) {
  const k = d.kpis;
  const periodos = [...new Set(d.puntualidad_trimestral.map((p) => p.periodo))].sort();
  const provsTrim = [...new Map(d.puntualidad_trimestral.map((p) => [p.codigo, p.nombre])).entries()];
  const celda = new Map(d.puntualidad_trimestral.map((p) => [`${p.codigo}|${p.periodo}`, p]));
  const maxConsumo = Math.max(1, ...d.consumo_categoria.map((c) => c.consumo_valorado));

  return (
    <div className="space-y-4">
      {/* Cuadre: lo primero que se ve, porque dice si se puede confiar en el resto de la página. */}
      <Panel className={cx('overflow-hidden', d.cuadre.al_dia ? 'shadow-[inset_0_3px_0_var(--verde)]' : 'shadow-[inset_0_3px_0_var(--ambar)]')}>
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 pb-3">
          <div className="min-w-0">
            <h2 className="titulo text-lg leading-tight">{d.cuadre.al_dia ? 'Gold cuadra con la base operativa' : 'La base operativa ha cambiado desde el último pipeline'}</h2>
            <p className="mt-0.5 max-w-[80ch] text-tenue">
              {d.cuadre.al_dia
                ? 'Las ocho medidas dan el mismo resultado calculadas en vivo sobre PostgreSQL y sobre el modelo en estrella.'
                : 'Hay operaciones registradas que todavía no han pasado por Bronze, Silver y Gold. Los informes de esta página muestran la foto anterior.'}
              {filtrado && ' El cuadre se hace siempre sobre los últimos 12 meses y sin filtros.'}
            </p>
          </div>
          {!d.cuadre.al_dia && <BotonPipeline p={pipeline} />}
        </div>
        <Tabla minimo={560}>
          <thead><tr><Th>Medida</Th><Th der>Base operativa (en vivo)</Th><Th der>Gold (último pipeline)</Th><Th>Cuadre</Th></tr></thead>
          <tbody>
            {d.cuadre.lineas.map((l) => (
              <tr key={l.campo} className={l.coincide ? '' : 'bg-ambar-suave/50'}>
                <Td>{l.medida_dax}</Td>
                <Td der>{valorCuadre(l, l.operativo)}</Td>
                <Td der>{valorCuadre(l, l.gold)}</Td>
                <Td>{l.coincide
                  ? <span className="inline-flex items-center gap-1 text-verde"><Check size={15} aria-hidden />Coincide</span>
                  : <span className="inline-flex items-center gap-1 font-medium text-ambar"><X size={15} aria-hidden />Desfasado</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      </Panel>

      <Seccion titulo={`Indicadores del ${fecha(d.periodo.desde)} al ${fecha(d.periodo.hasta)}`}
        dax={['Coste total de compras', '% Entregas puntuales', 'Retraso medio (días)', 'Valor del inventario', 'Consumo valorado', 'Rotación de inventario']}>
        <div className="grid grid-cols-2 gap-px bg-linea/70 md:grid-cols-3 xl:grid-cols-6">
          {[
            ['Coste total de compras', eur0(k.gasto_compras), `${num(k.pedidos)} pedidos, ${num(k.pedidos_completados)} completados`],
            ['Entregas puntuales', pct(k.entregas_puntuales, 1), `Retraso medio de ${num(k.retraso_medio_dias, 2)} días`],
            ['Plazo real medio', k.plazo_real_medio_dias === null ? '—' : `${num(k.plazo_real_medio_dias, 1)} días`, `Rechazo del ${pct(k.tasa_rechazo, 2)} de las unidades`],
            ['Valor del inventario', eur0(k.valor_inventario), `Al cierre del periodo, ${num(k.productos_bajo_minimo)} productos bajo mínimo`],
            ['Consumo valorado', eur0(k.consumo_valorado), `${num(k.consumo_unidades)} unidades`],
            ['Rotación de inventario', k.rotacion_inventario === null ? '—' : `${num(k.rotacion_inventario, 1)}×`, 'Consumo anualizado ÷ valor del inventario'],
          ].map(([e, v, n]) => (
            <div key={e} className="bg-panel px-4 py-3"><p className="text-[13px] text-tenue">{e}</p><p className="cifra titulo mt-1 text-2xl leading-none">{v}</p><p className="mt-1.5 text-xs text-tenue">{n}</p></div>
          ))}
        </div>
      </Seccion>

      <Seccion titulo="Evolución mensual del gasto" dax={['Variación mensual del gasto %', 'Gasto acumulado del año', 'Gasto media móvil 3 meses']} sql="analitica.vw_gasto_mensual">
        {d.gasto_mensual.length === 0 ? <Vacio titulo="Sin compras en el periodo" texto="Amplía las fechas o quita filtros." /> : (
          <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <div className="h-72 px-2 pt-4 pb-1">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={d.gasto_mensual} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--linea)" strokeDasharray="2 4" />
                    <XAxis dataKey="anio_mes" tickFormatter={mes} tickLine={false} axisLine={{ stroke: 'var(--linea)' }} interval="preserveStartEnd" minTickGap={8} />
                    <YAxis tickFormatter={(v) => eurK(v)} tickLine={false} axisLine={false} width={62} />
                    <Tooltip cursor={{ fill: 'var(--panel2)' }} content={<CajaTooltip titulo={(l: string) => mes(l)} filas={(p: any) => [['Gasto', eur0(p.gasto)], ['Media móvil 3 m', eur0(p.media_movil_3m)], ['Variación', pctSigno(p.variacion)]]} />} />
                    <Bar dataKey="gasto" fill="var(--marca)" radius={[3, 3, 0, 0]} maxBarSize={38} isAnimationActive={false} />
                    <Line dataKey="media_movil_3m" stroke="var(--ambar)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="flex flex-wrap gap-x-4 px-4 pb-3 text-xs text-tenue">
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-marca" aria-hidden />Gasto del mes</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-ambar" aria-hidden />Media móvil de 3 meses</span>
              </p>
            </div>
            <div className="min-w-0 border-t border-linea xl:border-t-0 xl:border-l">
              <Tabla minimo={520}>
                <thead><tr><Th>Mes</Th><Th der>Gasto</Th><Th der>Variación</Th><Th der>Acumulado del año</Th><Th der>Media móvil 3 m</Th></tr></thead>
                <tbody>
                  {d.gasto_mensual.map((m) => (
                    <tr key={m.anio_mes}>
                      <Td className="whitespace-nowrap capitalize">{mes(m.anio_mes)}</Td>
                      <Td der>{eur0(m.gasto)}</Td>
                      <Td der className={m.variacion === null ? 'text-tenue' : m.variacion > 0.1 ? 'text-rojo' : m.variacion < -0.1 ? 'text-verde' : ''}>{pctSigno(m.variacion)}</Td>
                      <Td der>{eur0(m.acumulado_anio)}</Td>
                      <Td der className="text-tenue">{eur0(m.media_movil_3m)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Tabla>
            </div>
          </div>
        )}
      </Seccion>

      <Seccion titulo="Rendimiento de proveedores" dax={['Ranking de proveedor por gasto', 'Cuota de gasto %', 'Desviación de plazo (días)', '% Rechazo']} sql="analitica.vw_rendimiento_proveedor">
        {d.proveedores.length === 0 ? <Vacio titulo="Sin pedidos en el periodo" /> : (
          <Tabla minimo={1040}>
            <thead><tr><Th der>N.º</Th><Th>Proveedor</Th><Th>Estado</Th><Th der>Pedidos</Th><Th der>Gasto</Th><Th className="w-36">Cuota</Th><Th der>Puntuales</Th><Th der>Retraso medio</Th><Th der>Plazo real / acordado</Th><Th der>Desviación</Th><Th der>Rechazo</Th></tr></thead>
            <tbody>
              {d.proveedores.map((p) => (
                <tr key={p.proveedor_id} className={p.entregas_puntuales !== null && p.entregas_puntuales < 0.7 ? 'shadow-[inset_3px_0_0_var(--rojo)]' : ''}>
                  <Td der className="text-tenue">{p.ranking_gasto}</Td>
                  <Td><p className="font-medium">{p.nombre}</p><p className="cifra text-[13px] text-tenue">{p.codigo}</p></Td>
                  <Td><Insignia tono={TONO_PROVEEDOR[p.estado]}>{ETIQUETA_ESTADO_PROVEEDOR[p.estado] ?? p.estado}</Insignia></Td>
                  <Td der>{num(p.pedidos)}</Td>
                  <Td der>{eur0(p.gasto)}</Td>
                  <Td><div className="flex items-center gap-2"><Barra className="flex-1" valor={p.cuota_gasto / (d.proveedores[0].cuota_gasto || 1)} /><span className="cifra w-11 text-right text-[13px] text-tenue">{pct(p.cuota_gasto, 1)}</span></div></Td>
                  <Td der className={cx('font-medium', claseTono[tonoOtd(p.entregas_puntuales)])}>{pct(p.entregas_puntuales)}</Td>
                  <Td der>{p.retraso_medio_dias === null ? '—' : `${num(p.retraso_medio_dias, 1)} d`}</Td>
                  <Td der>{p.plazo_real_dias === null ? '—' : num(p.plazo_real_dias, 1)} / {p.plazo_acordado_dias} d</Td>
                  <Td der className={p.desviacion_plazo_dias === null ? 'text-tenue' : p.desviacion_plazo_dias > 1 ? 'text-rojo' : p.desviacion_plazo_dias > 0.4 ? 'text-ambar' : 'text-verde'}>
                    {p.desviacion_plazo_dias === null ? '—' : `${p.desviacion_plazo_dias > 0 ? '+' : '−'}${num(Math.abs(p.desviacion_plazo_dias), 1)} d`}</Td>
                  <Td der>{pct(p.tasa_rechazo, 2)}</Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Seccion>

      <Seccion titulo="Puntualidad por trimestre y proveedor" dax={['% Entregas puntuales']} sql="analitica.vw_puntualidad_trimestral" nota="Cada celda es el porcentaje de pedidos completados a tiempo ese trimestre">
        {periodos.length === 0 ? <Vacio titulo="Sin pedidos completados en el periodo" /> : (
          <>
            <Tabla minimo={Math.max(520, 260 + periodos.length * 96)}>
              <thead><tr><Th>Proveedor</Th>{periodos.map((p) => <Th key={p} className="text-center">{p}</Th>)}</tr></thead>
              <tbody>
                {provsTrim.map(([codigo, nombre]) => (
                  <tr key={codigo}>
                    <Td><p className="max-w-[230px] truncate font-medium">{nombre}</p><p className="cifra text-[13px] text-tenue">{codigo}</p></Td>
                    {periodos.map((per) => {
                      const c = celda.get(`${codigo}|${per}`);
                      if (!c) return <Td key={per} className="text-center text-tenue">—</Td>;
                      const t = tonoOtd(c.entregas_puntuales);
                      return (
                        <td key={per} className="border-b border-linea/70 p-1">
                          <div className={cx('cifra rounded-sm px-2 py-1.5 text-center', t === 'verde' ? 'bg-verde-suave text-verde' : t === 'ambar' ? 'bg-ambar-suave text-ambar' : 'bg-rojo-suave text-rojo')}
                            title={`${num(c.pedidos)} pedidos, retraso medio ${num(c.retraso_medio_dias, 1)} días`}>
                            <span className="font-medium">{pct(c.entregas_puntuales)}</span>
                            {c.variacion !== null && Math.abs(c.variacion) >= 0.1 && <span className="ml-1 text-xs">{c.variacion > 0 ? '▲' : '▼'}</span>}
                            <span className="block text-[11px] opacity-80">{num(c.pedidos)} ped.</span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </Tabla>
            <p className="px-4 py-2.5 text-xs text-tenue">Verde: 85 % o más. Ámbar: entre 70 y 85 %. Rojo: menos del 70 %. La flecha marca un cambio de 10 puntos o más frente al trimestre anterior.</p>
          </>
        )}
      </Seccion>

      <div className="grid gap-4 xl:grid-cols-2">
        <Seccion titulo="Consumo e inventario por categoría" dax={['Consumo valorado', 'Cuota de consumo por categoría %', 'Rotación de inventario']} sql="analitica.vw_stock_actual">
          {d.consumo_categoria.length === 0 ? <Vacio titulo="Sin datos de consumo" /> : (
            <Tabla minimo={600}>
              <thead><tr><Th>Categoría</Th><Th der>Consumo</Th><Th className="w-32">Cuota</Th><Th der>Inventario</Th><Th der>Rotación</Th><Th der>Bajo mínimo</Th></tr></thead>
              <tbody>
                {d.consumo_categoria.map((c) => (
                  <tr key={c.categoria}>
                    <Td>{c.categoria}</Td>
                    <Td der>{eur0(c.consumo_valorado)}</Td>
                    <Td><div className="flex items-center gap-2"><Barra className="flex-1" valor={c.consumo_valorado / maxConsumo} /><span className="cifra w-9 text-right text-[13px] text-tenue">{pct(c.cuota)}</span></div></Td>
                    <Td der>{eur0(c.valor_inventario)}</Td>
                    <Td der>{c.rotacion === null ? '—' : `${num(c.rotacion, 1)}×`}</Td>
                    <Td der className={c.bajo_minimo > 0 ? 'font-medium text-ambar' : 'text-tenue'}>{c.bajo_minimo}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          )}
        </Seccion>

        <Seccion titulo="Valor del inventario al cierre de cada mes" dax={['Valor del inventario']} sql="analitica.inventario_diario" nota="Medida semiaditiva: se toma la última foto del mes, no la suma de los días">
          {d.inventario_mensual.length === 0 ? <Vacio titulo="Sin fotos de inventario en el periodo" /> : (
            <>
              <div className="h-64 px-2 pt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={d.inventario_mensual} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--linea)" strokeDasharray="2 4" />
                    <XAxis dataKey="anio_mes" tickFormatter={mes} tickLine={false} axisLine={{ stroke: 'var(--linea)' }} interval="preserveStartEnd" minTickGap={8} />
                    <YAxis tickFormatter={(v) => eurK(v)} tickLine={false} axisLine={false} width={62} domain={[0, 'auto']} />
                    <Tooltip content={<CajaTooltip titulo={(l: string) => mes(l)} filas={(p: any) => [['Al cierre del mes', eur0(p.valor_cierre)], ['Media del mes', eur0(p.valor_medio)], ['Máx. roturas en un día', num(p.max_roturas_dia)]]} />} />
                    <Area dataKey="valor_cierre" stroke="var(--marca)" strokeWidth={2} fill="var(--marca)" fillOpacity={0.14} isAnimationActive={false} />
                    <Line dataKey="valor_medio" stroke="var(--tenue)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5 text-xs text-tenue">
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-marca" aria-hidden />Valor al cierre del mes</span>
                <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t border-dashed border-tenue" aria-hidden />Media del mes</span>
                <span>Sumar el valor de cada día no tiene sentido: se contaría el mismo stock muchas veces.</span>
              </p>
            </>
          )}
        </Seccion>
      </div>
    </div>
  );
}
