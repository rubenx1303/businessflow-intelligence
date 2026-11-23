import { ArrowRight, RotateCcw } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Barra, CajaTooltip, claseTono, tonoOtd, tonoPuntuacion } from '../components/graficos';
import { Boton, Cabecera, Carga, cx, Entrada, Esqueleto, Filtro, Panel, Selector, TituloPanel, Vacio } from '../components/ui';
import { api, useDatos, type Almacen, type Dashboard as Datos, type Producto, type Proveedor } from '../lib/api';
import { useFiltrosUrl } from '../lib/filtros';
import { cant, eur, eur0, eurK, fecha, mes, num, pct } from '../lib/format';

const CLAVES = ['desde', 'hasta', 'almacen', 'categoria', 'proveedor', 'producto'] as const;
interface Kpi { etiqueta: string; valor: string; calculo: string; tono?: 'verde' | 'ambar' | 'rojo'; a?: string }
const tonoKpi = (t: ReturnType<typeof tonoOtd>) => (t === 'marca' ? undefined : t);

function BandaKpis({ d }: { d: Datos }) {
  const k = d.kpis;
  const pctRetraso = k.pedidos_completados > 0 ? k.pedidos_con_retraso / k.pedidos_completados : null;
  const kpis: Kpi[] = [
    { etiqueta: 'Compras totales', valor: eur0(k.gasto_compras), calculo: `Cantidad × precio de las líneas de ${num(k.pedidos)} pedidos enviados o recibidos` },
    { etiqueta: 'Valor del inventario', valor: eur0(k.valor_inventario), calculo: 'Stock de hoy × coste estándar de cada producto' },
    { etiqueta: 'Consumo', valor: eur0(k.consumo_valorado), calculo: 'Salidas del periodo valoradas a su coste' },
    { etiqueta: 'Rotación de inventario', valor: k.rotacion_inventario === null ? '—' : `${num(k.rotacion_inventario, 1)}×`, calculo: k.rotacion_inventario ? `Consumo anualizado ÷ valor del inventario. Hay stock para ${num(365 / k.rotacion_inventario)} días` : 'Consumo anualizado ÷ valor del inventario' },
    { etiqueta: 'Bajo mínimo', valor: num(k.productos_bajo_minimo), tono: k.productos_bajo_minimo > 0 ? 'ambar' : 'verde', calculo: 'Productos activos con stock total inferior a su mínimo', a: '/inventario?bajo=1' },
    { etiqueta: 'Puntualidad', valor: pct(k.entregas_puntuales), tono: tonoKpi(tonoOtd(k.entregas_puntuales)), calculo: 'Pedidos completados cuya última recepción llegó en la fecha prevista o antes' },
    { etiqueta: 'Retraso medio', valor: k.retraso_medio_dias === null ? '—' : `${num(k.retraso_medio_dias, 1)} días`, calculo: 'Días sobre la fecha prevista por pedido completado (0 si llegó a tiempo)' },
    { etiqueta: 'Pedidos con retraso', valor: `${num(k.pedidos_con_retraso)} de ${num(k.pedidos_completados)}`, tono: pctRetraso !== null && pctRetraso > 0.3 ? 'rojo' : pctRetraso !== null && pctRetraso > 0.15 ? 'ambar' : undefined, calculo: `Completados que llegaron tarde${pctRetraso === null ? '' : `: ${pct(pctRetraso)}`}` },
    { etiqueta: 'Pedidos abiertos', valor: num(k.pedidos_abiertos), calculo: 'Enviados o recibidos en parte, a día de hoy', a: '/compras?estado=enviado' },
    { etiqueta: 'Abiertos fuera de plazo', valor: num(k.pedidos_retrasados), tono: k.pedidos_retrasados > 0 ? 'rojo' : 'verde', calculo: 'Abiertos con la fecha prevista ya superada' },
  ];
  // Una sola banda dividida por filetes, como la cabecera de un albarán: los datos se leen juntos.
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-linea bg-linea md:grid-cols-5">
      {kpis.map((x) => {
        const cuerpo = (
          <>
            <p className="text-[13px] text-tenue">{x.etiqueta}</p>
            <p className={cx('cifra titulo mt-1 text-2xl leading-none xl:text-[26px]', x.tono && claseTono[x.tono])}>{x.valor}</p>
            <p className="mt-1.5 text-xs text-tenue">{x.calculo}</p>
          </>
        );
        return x.a
          ? <Link key={x.etiqueta} to={x.a} className="bg-panel px-4 py-3.5 transition-colors hover:bg-panel2">{cuerpo}</Link>
          : <div key={x.etiqueta} className="bg-panel px-4 py-3.5">{cuerpo}</div>;
      })}
    </div>
  );
}

const COLOR_TRAMO: Record<string, string> = { 'A tiempo': 'var(--verde)', '1-2 días': 'var(--ambar)', '3-5 días': 'var(--ambar)', 'Más de 5 días': 'var(--rojo)' };

export function Dashboard() {
  const { f, cambiar, limpiar, activos } = useFiltrosUrl(CLAVES);
  const r = useDatos((s) => api.get<Datos>('/dashboard', { desde: f.desde, hasta: f.hasta, almacen_id: f.almacen, categoria: f.categoria, proveedor_id: f.proveedor, producto_id: f.producto }, s),
    [f.desde, f.hasta, f.almacen, f.categoria, f.proveedor, f.producto]);
  const almacenes = useDatos((s) => api.get<Almacen[]>('/inventario/almacenes', undefined, s), []);
  const categorias = useDatos((s) => api.get<string[]>('/inventario/categorias', undefined, s), []);
  const proveedores = useDatos((s) => api.get<Proveedor[]>('/proveedores', undefined, s), []);
  const productos = useDatos((s) => api.get<Producto[]>('/inventario/productos', undefined, s), []);
  const rangoInvalido = !!f.desde && !!f.hasta && f.desde > f.hasta;

  // El selector de producto solo ofrece los de la categoría elegida; si deja de encajar, se quita.
  const productosVisibles = useMemo(() => (productos.datos ?? []).filter((p) => !f.categoria || p.categoria === f.categoria), [productos.datos, f.categoria]);
  useEffect(() => {
    if (f.producto && productos.datos && !productosVisibles.some((p) => String(p.id) === f.producto)) cambiar({ producto: '' });
  }, [f.producto, productos.datos, productosVisibles, cambiar]);

  return (
    <>
      <Cabecera titulo="Panel de dirección"
        descripcion={r.datos ? `Del ${fecha(r.datos.periodo.desde)} al ${fecha(r.datos.periodo.hasta)}, calculado en vivo sobre la base operativa.` : 'Últimos 12 meses'} />

      <div className="mb-4 grid grid-cols-2 gap-2 lg:flex lg:flex-wrap lg:items-center">
        <Filtro etiqueta="Desde">{(id) => <Entrada id={id} type="date" value={f.desde} max={f.hasta || undefined} onChange={(e) => cambiar({ desde: e.target.value })} className="lg:w-40" />}</Filtro>
        <Filtro etiqueta="Hasta">{(id) => <Entrada id={id} type="date" value={f.hasta} min={f.desde || undefined} onChange={(e) => cambiar({ hasta: e.target.value })} className="lg:w-40" />}</Filtro>
        <Filtro etiqueta="Almacén">{(id) => (
          <Selector id={id} value={f.almacen} onChange={(e) => cambiar({ almacen: e.target.value })} className="lg:w-44">
            <option value="">Todos los almacenes</option>
            {almacenes.datos?.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </Selector>)}</Filtro>
        <Filtro etiqueta="Proveedor">{(id) => (
          <Selector id={id} value={f.proveedor} onChange={(e) => cambiar({ proveedor: e.target.value })} className="lg:w-52">
            <option value="">Todos los proveedores</option>
            {proveedores.datos?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </Selector>)}</Filtro>
        <Filtro etiqueta="Categoría">{(id) => (
          <Selector id={id} value={f.categoria} onChange={(e) => cambiar({ categoria: e.target.value })} className="lg:w-48">
            <option value="">Todas las categorías</option>
            {categorias.datos?.map((c) => <option key={c}>{c}</option>)}
          </Selector>)}</Filtro>
        <Filtro etiqueta="Producto">{(id) => (
          <Selector id={id} value={f.producto} onChange={(e) => cambiar({ producto: e.target.value })} className="lg:w-56">
            <option value="">{f.categoria ? `Todos los de ${f.categoria}` : 'Todos los productos'}</option>
            {productosVisibles.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.nombre}</option>)}
          </Selector>)}</Filtro>
        {activos && <Boton variante="fantasma" className="col-span-2" onClick={limpiar}><RotateCcw size={15} />Limpiar filtros</Boton>}
      </div>
      {rangoInvalido && <p role="alert" className="mb-3 text-rojo">La fecha inicial es posterior a la final.</p>}
      {f.proveedor && <p className="mb-3 text-[13px] text-tenue">Con proveedor elegido, compras y entregas son las de sus pedidos; inventario y consumo, los de los productos que lo tienen como proveedor preferente.</p>}

      <Carga r={r} esqueleto={<EsqueletoPanel />}>
        {(d) => {
          const meses = [...new Set([...d.gasto_mensual.map((m) => m.mes), ...d.consumo_mensual.map((m) => m.mes)])].sort()
            .map((m) => ({ mes: m, gasto: d.gasto_mensual.find((x) => x.mes === m)?.gasto ?? 0, pedidos: d.gasto_mensual.find((x) => x.mes === m)?.pedidos ?? 0, consumo: d.consumo_mensual.find((x) => x.mes === m)?.valor ?? 0 }));
          const totalDist = d.distribucion_retraso.reduce((s, t) => s + t.pedidos, 0);
          return (
            <div className="space-y-4">
              <BandaKpis d={d} />

              <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <Panel>
                  <TituloPanel extra={
                    <span className="flex items-center gap-3 text-[13px] text-tenue">
                      <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-marca" aria-hidden />Compras</span>
                      <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-ambar" aria-hidden />Consumo</span>
                    </span>}>Evolución mensual</TituloPanel>
                  {meses.length === 0 ? <Vacio titulo="Sin actividad en el periodo" texto="Amplía el rango de fechas o quita filtros." /> : (
                    <div className="h-72 px-2 pt-4 pb-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={meses} margin={{ top: 4, right: 12, left: 4, bottom: 0 }} barGap={2}>
                          <CartesianGrid vertical={false} stroke="var(--linea)" strokeDasharray="2 4" />
                          <XAxis dataKey="mes" tickFormatter={mes} tickLine={false} axisLine={{ stroke: 'var(--linea)' }} interval="preserveStartEnd" minTickGap={8} />
                          <YAxis tickFormatter={(v) => eurK(v)} tickLine={false} axisLine={false} width={62} />
                          <Tooltip cursor={{ fill: 'var(--panel2)' }} content={<CajaTooltip titulo={(l: string) => mes(l)} filas={(p: any) => [['Compras', eur0(p.gasto)], ['Consumo', eur0(p.consumo)], ['Pedidos', num(p.pedidos)]]} />} />
                          <Bar dataKey="gasto" name="Compras" fill="var(--marca)" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                          <Bar dataKey="consumo" name="Consumo" fill="var(--ambar)" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <p className="border-t border-linea/70 px-4 py-2 text-xs text-tenue">Compras: importe pedido en el mes. Consumo: salidas de almacén valoradas a coste. Si las compras superan al consumo de forma sostenida, el stock crece.</p>
                </Panel>

                <Panel>
                  <TituloPanel extra={<span className="text-[13px] text-tenue">Salidas valoradas a coste</span>}>Consumo por categoría</TituloPanel>
                  {d.consumo_categoria.length === 0 ? <Vacio titulo="Sin consumo en el periodo" /> : (
                    <ul className="space-y-3 px-4 py-4">
                      {d.consumo_categoria.map((c) => (
                        <li key={c.categoria}>
                          <div className="mb-1 flex items-baseline justify-between gap-3">
                            <span className="truncate">{c.categoria}</span>
                            <span className="cifra shrink-0"><span className="font-medium">{eur0(c.valor)}</span> <span className="text-tenue">{pct(c.valor / (d.kpis.consumo_valorado || 1))}</span></span>
                          </div>
                          <Barra valor={c.valor / d.consumo_categoria[0].valor} />
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <Panel>
                  <TituloPanel extra={<Link to="/inteligencia?vista=proveedores" className="inline-flex items-center gap-1 text-[13px] font-medium text-marca hover:underline">Análisis completo<ArrowRight size={14} /></Link>}>Proveedores principales</TituloPanel>
                  {d.top_proveedores.length === 0 ? <Vacio titulo="Sin pedidos en el periodo" /> : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[560px] text-left">
                        <thead><tr className="text-[13px] text-tenue">
                          <th className="px-4 py-2 font-medium">Proveedor</th><th className="px-3 py-2 text-right font-medium">Gasto</th>
                          <th className="px-3 py-2 text-right font-medium">Puntuales</th><th className="px-3 py-2 text-right font-medium">Retraso</th>
                          <th className="w-36 px-4 py-2 font-medium">Puntuación</th>
                        </tr></thead>
                        <tbody>
                          {d.top_proveedores.map((p) => (
                            <tr key={p.proveedor_id} className="border-t border-linea/70">
                              <td className="max-w-[240px] truncate px-4 py-2">{p.nombre}</td>
                              <td className="cifra px-3 py-2 text-right">{eur0(p.gasto)}</td>
                              <td className={cx('cifra px-3 py-2 text-right', claseTono[tonoOtd(p.otd)])}>{pct(p.otd)}</td>
                              <td className="cifra px-3 py-2 text-right">{p.retraso_medio === null ? '—' : `${num(p.retraso_medio, 1)} d`}</td>
                              <td className="px-4 py-2">
                                <div className="flex items-center gap-2">
                                  <Barra valor={(p.puntuacion ?? 0) / 100} tono={tonoPuntuacion(p.puntuacion)} className="flex-1" />
                                  <span className="cifra w-7 text-right font-medium">{p.puntuacion ?? '—'}</span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>

                <Panel>
                  <TituloPanel extra={<span className="cifra text-[13px] text-tenue">{num(d.kpis.pedidos_con_retraso)} con retraso de {num(d.kpis.pedidos_completados)} completados</span>}>Retrasos en las entregas</TituloPanel>
                  {totalDist === 0 ? <Vacio titulo="Sin pedidos completados en el periodo" /> : (
                    <>
                      <div className="h-52 px-2 pt-4">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={d.distribucion_retraso} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                            <CartesianGrid vertical={false} stroke="var(--linea)" strokeDasharray="2 4" />
                            <XAxis dataKey="tramo" tickLine={false} axisLine={{ stroke: 'var(--linea)' }} interval={0} />
                            <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                            <Tooltip cursor={{ fill: 'var(--panel2)' }} content={<CajaTooltip filas={(p: any) => [['Pedidos', num(p.pedidos)], ['Del total', pct(p.pedidos / totalDist)]]} />} />
                            <Bar dataKey="pedidos" radius={[3, 3, 0, 0]} maxBarSize={56} isAnimationActive={false}>
                              {d.distribucion_retraso.map((t) => <Cell key={t.tramo} fill={COLOR_TRAMO[t.tramo] ?? 'var(--marca)'} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="px-4 py-2.5 text-xs text-tenue">Pedidos completados según los días que pasaron entre la fecha prevista y la última recepción.{(f.categoria || f.producto) && ' Este gráfico no se filtra por categoría ni producto.'}</p>
                    </>
                  )}
                </Panel>
              </div>

              <Panel>
                <TituloPanel>Requiere atención</TituloPanel>
                {d.alertas.bajo_minimo.length + d.alertas.pedidos_retrasados.length === 0
                  ? <Vacio titulo="Nada pendiente" texto="No hay productos bajo mínimo ni pedidos fuera de plazo." />
                  : (
                    <div className="grid grid-cols-1 gap-x-px bg-linea/70 lg:grid-cols-2">
                      <div className="min-w-0 divide-y divide-linea/70 bg-panel">
                        {d.alertas.pedidos_retrasados.length === 0 && <p className="px-4 py-6 text-center text-tenue">Ningún pedido abierto fuera de plazo.</p>}
                        {d.alertas.pedidos_retrasados.map((p) => (
                          <Link key={p.id} to={`/compras/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 shadow-[inset_3px_0_0_var(--rojo)] transition-colors hover:bg-panel2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate"><span className="cifra font-medium">{p.numero}</span> <span className="text-tenue">{p.proveedor}</span></p>
                              <p className="text-[13px] text-tenue">Previsto el {fecha(p.fecha_entrega_prevista)}</p>
                            </div>
                            <span className="cifra shrink-0 font-medium text-rojo">{num(p.dias_retraso)} {p.dias_retraso === 1 ? 'día' : 'días'} tarde</span>
                          </Link>
                        ))}
                      </div>
                      <div className="min-w-0 divide-y divide-linea/70 bg-panel">
                        {d.alertas.bajo_minimo.length === 0 && <p className="px-4 py-6 text-center text-tenue">Ningún producto bajo mínimo.</p>}
                        {d.alertas.bajo_minimo.map((p) => (
                          <Link key={p.id} to={`/inventario?bajo=1&buscar=${encodeURIComponent(p.sku)}`} className="flex items-center gap-3 px-4 py-2.5 shadow-[inset_3px_0_0_var(--ambar)] transition-colors hover:bg-panel2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate">{p.nombre}</p>
                              <p className="cifra text-[13px] text-tenue">{p.sku}</p>
                            </div>
                            <span className="cifra shrink-0 text-right"><span className="font-medium text-ambar">{cant(p.stock)}</span> <span className="text-tenue">de {cant(p.stock_minimo)} {p.unidad}</span></span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
              </Panel>
              <p className="text-[13px] text-tenue">
                Consumo valorado del periodo: {eur(d.kpis.consumo_valorado)}. Estas cifras cambian en cuanto se registra una operación.{' '}
                <Link to="/informes" className="font-medium text-marca hover:underline">Informes</Link> calcula las mismas medidas sobre la capa Gold del circuito de datos.
              </p>
            </div>
          );
        }}
      </Carga>
    </>
  );
}

function EsqueletoPanel() {
  return (
    <div className="space-y-4" role="status" aria-label="Cargando panel">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-linea bg-linea md:grid-cols-5">
        {Array.from({ length: 10 }, (_, i) => <div key={i} className="bg-panel px-4 py-3.5"><Esqueleto className="h-3 w-20" /><Esqueleto className="mt-2.5 h-6 w-24" /><Esqueleto className="mt-2.5 h-3 w-28" /></div>)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel className="h-80 p-4"><Esqueleto className="h-full w-full" /></Panel>
        <Panel className="h-80 p-4"><Esqueleto className="h-full w-full" /></Panel>
      </div>
    </div>
  );
}
