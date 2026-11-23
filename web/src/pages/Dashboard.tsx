import { ArrowRight, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Barra, CajaTooltip, claseTono, tonoOtd, tonoPuntuacion } from '../components/graficos';
import { Boton, Cabecera, Carga, cx, Entrada, Esqueleto, Filtro, Panel, Selector, TituloPanel, Vacio } from '../components/ui';
import { api, useDatos, type Almacen, type Dashboard as Datos } from '../lib/api';
import { cant, eur, eur0, eurK, fecha, mes, num, pct } from '../lib/format';

interface Kpi { etiqueta: string; valor: string; nota?: string; tono?: 'verde' | 'ambar' | 'rojo'; a?: string }

function BandaKpis({ d }: { d: Datos }) {
  const k = d.kpis;
  const kpis: Kpi[] = [
    { etiqueta: 'Gasto en compras', valor: eur0(k.gasto_compras), nota: `${num(k.pedidos)} pedidos en el periodo` },
    { etiqueta: 'Valor del inventario', valor: eur0(k.valor_inventario), nota: 'A coste estándar, hoy' },
    { etiqueta: 'Rotación de inventario', valor: k.rotacion_inventario === null ? '—' : `${num(k.rotacion_inventario, 1)}×`, nota: k.rotacion_inventario ? `Stock para ${num(365 / k.rotacion_inventario)} días de consumo` : 'Sin inventario valorado' },
    { etiqueta: 'Entregas puntuales', valor: pct(k.entregas_puntuales), tono: tonoOtd(k.entregas_puntuales) === 'marca' ? undefined : (tonoOtd(k.entregas_puntuales) as Kpi['tono']), nota: 'Pedidos completados en fecha' },
    { etiqueta: 'Retraso medio', valor: k.retraso_medio_dias === null ? '—' : `${num(k.retraso_medio_dias, 1)} días`, nota: 'Sobre la fecha prevista' },
    { etiqueta: 'Productos bajo mínimo', valor: num(k.productos_bajo_minimo), tono: k.productos_bajo_minimo > 0 ? 'ambar' : 'verde', nota: 'Ver existencias', a: '/inventario?bajo=1' },
    { etiqueta: 'Pedidos abiertos', valor: num(k.pedidos_abiertos), nota: 'Enviados o recibidos en parte', a: '/compras?estado=enviado' },
    { etiqueta: 'Pedidos retrasados', valor: num(k.pedidos_retrasados), tono: k.pedidos_retrasados > 0 ? 'rojo' : 'verde', nota: 'Fecha prevista superada' },
  ];
  // Una sola banda dividida por filetes, como la cabecera de un albarán: los ocho datos se leen juntos.
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-linea bg-linea sm:grid-cols-4 xl:grid-cols-8">
      {kpis.map((x) => {
        const cuerpo = (
          <>
            <p className="text-[13px] text-tenue">{x.etiqueta}</p>
            <p className={cx('cifra titulo mt-1 text-[26px] leading-none', x.tono && claseTono[x.tono])}>{x.valor}</p>
            {x.nota && <p className="mt-1.5 text-xs text-tenue">{x.nota}</p>}
          </>
        );
        return x.a
          ? <Link key={x.etiqueta} to={x.a} className="bg-panel px-4 py-3.5 transition-colors hover:bg-panel2">{cuerpo}</Link>
          : <div key={x.etiqueta} className="bg-panel px-4 py-3.5">{cuerpo}</div>;
      })}
    </div>
  );
}

export function Dashboard() {
  const [f, setF] = useState({ desde: '', hasta: '', almacen_id: '', categoria: '' });
  const r = useDatos((s) => api.get<Datos>('/dashboard', f, s), [f.desde, f.hasta, f.almacen_id, f.categoria]);
  const almacenes = useDatos((s) => api.get<Almacen[]>('/inventario/almacenes', undefined, s), []);
  const categorias = useDatos((s) => api.get<string[]>('/inventario/categorias', undefined, s), []);
  const filtrado = Object.values(f).some(Boolean);
  const rangoInvalido = !!f.desde && !!f.hasta && f.desde > f.hasta;

  return (
    <>
      <Cabecera titulo="Panel de dirección"
        descripcion={r.datos ? `Del ${fecha(r.datos.periodo.desde)} al ${fecha(r.datos.periodo.hasta)}` : 'Últimos 12 meses'} />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Filtro etiqueta="Desde">{(id) => <Entrada id={id} type="date" value={f.desde} max={f.hasta || undefined} onChange={(e) => setF({ ...f, desde: e.target.value })} className="sm:w-40" />}</Filtro>
        <Filtro etiqueta="Hasta">{(id) => <Entrada id={id} type="date" value={f.hasta} min={f.desde || undefined} onChange={(e) => setF({ ...f, hasta: e.target.value })} className="sm:w-40" />}</Filtro>
        <Filtro etiqueta="Almacén">{(id) => (
          <Selector id={id} value={f.almacen_id} onChange={(e) => setF({ ...f, almacen_id: e.target.value })} className="sm:w-48">
            <option value="">Todos los almacenes</option>
            {almacenes.datos?.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </Selector>)}</Filtro>
        <Filtro etiqueta="Categoría">{(id) => (
          <Selector id={id} value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} className="sm:w-52">
            <option value="">Todas las categorías</option>
            {categorias.datos?.map((c) => <option key={c}>{c}</option>)}
          </Selector>)}</Filtro>
        {filtrado && <Boton variante="fantasma" onClick={() => setF({ desde: '', hasta: '', almacen_id: '', categoria: '' })}><RotateCcw size={15} />Quitar filtros</Boton>}
      </div>
      {rangoInvalido && <p role="alert" className="mb-3 text-rojo">La fecha inicial es posterior a la final.</p>}

      <Carga r={r} esqueleto={<EsqueletoPanel />}>
        {(d) => (
          <div className="space-y-4">
            <BandaKpis d={d} />

            <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Panel>
                <TituloPanel extra={<span className="text-[13px] text-tenue">Importe pedido por mes</span>}>Evolución del gasto</TituloPanel>
                {d.gasto_mensual.length === 0 ? <Vacio titulo="Sin compras en el periodo" texto="Amplía el rango de fechas o quita filtros." /> : (
                  <div className="h-72 px-2 pt-4 pb-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={d.gasto_mensual} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="var(--linea)" strokeDasharray="2 4" />
                        <XAxis dataKey="mes" tickFormatter={mes} tickLine={false} axisLine={{ stroke: 'var(--linea)' }} interval="preserveStartEnd" minTickGap={8} />
                        <YAxis tickFormatter={(v) => eurK(v)} tickLine={false} axisLine={false} width={62} />
                        <Tooltip cursor={{ fill: 'var(--panel2)' }} content={<CajaTooltip titulo={(l: string) => mes(l)} filas={(p: any) => [['Gasto', eur0(p.gasto)], ['Pedidos', num(p.pedidos)]]} />} />
                        <Bar dataKey="gasto" fill="var(--marca)" radius={[3, 3, 0, 0]} maxBarSize={42} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
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
                <TituloPanel extra={<Link to="/inteligencia?vista=proveedores" className="inline-flex items-center gap-1 text-[13px] font-medium text-marca hover:underline">Análisis completo<ArrowRight size={14} /></Link>}>Proveedores por gasto</TituloPanel>
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
                <TituloPanel>Requiere atención</TituloPanel>
                {d.alertas.bajo_minimo.length + d.alertas.pedidos_retrasados.length === 0
                  ? <Vacio titulo="Nada pendiente" texto="No hay productos bajo mínimo ni pedidos fuera de plazo." />
                  : (
                    <div className="divide-y divide-linea/70">
                      {d.alertas.pedidos_retrasados.map((p) => (
                        <Link key={`p${p.id}`} to={`/compras/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 shadow-[inset_3px_0_0_var(--rojo)] transition-colors hover:bg-panel2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate"><span className="cifra font-medium">{p.numero}</span> <span className="text-tenue">{p.proveedor}</span></p>
                            <p className="text-[13px] text-tenue">Previsto el {fecha(p.fecha_entrega_prevista)}</p>
                          </div>
                          <span className="cifra shrink-0 font-medium text-rojo">{num(p.dias_retraso)} {p.dias_retraso === 1 ? 'día' : 'días'} tarde</span>
                        </Link>
                      ))}
                      {d.alertas.bajo_minimo.map((p) => (
                        <Link key={`s${p.id}`} to={`/inventario?bajo=1&buscar=${encodeURIComponent(p.sku)}`} className="flex items-center gap-3 px-4 py-2.5 shadow-[inset_3px_0_0_var(--ambar)] transition-colors hover:bg-panel2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate">{p.nombre}</p>
                            <p className="cifra text-[13px] text-tenue">{p.sku}</p>
                          </div>
                          <span className="cifra shrink-0 text-right"><span className="font-medium text-ambar">{cant(p.stock)}</span> <span className="text-tenue">de {cant(p.stock_minimo)} {p.unidad}</span></span>
                        </Link>
                      ))}
                    </div>
                  )}
              </Panel>
            </div>
            <p className="text-[13px] text-tenue">Consumo valorado del periodo: {eur(d.kpis.consumo_valorado)}. La rotación anualiza ese consumo y lo divide entre el valor actual del inventario.</p>
          </div>
        )}
      </Carga>
    </>
  );
}

function EsqueletoPanel() {
  return (
    <div className="space-y-4" role="status" aria-label="Cargando panel">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-linea bg-linea sm:grid-cols-4 xl:grid-cols-8">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="bg-panel px-4 py-3.5"><Esqueleto className="h-3 w-20" /><Esqueleto className="mt-2.5 h-6 w-24" /><Esqueleto className="mt-2.5 h-3 w-28" /></div>)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel className="h-80 p-4"><Esqueleto className="h-full w-full" /></Panel>
        <Panel className="h-80 p-4"><Esqueleto className="h-full w-full" /></Panel>
      </div>
    </div>
  );
}
