import { ShoppingCart, TrendingDown, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Barra, CajaTooltip, claseTono, tonoOtd, tonoPuntuacion } from '../components/graficos';
import { Boton, Cabecera, Carga, cx, EsqueletoTabla, Fila, Insignia, Panel, Pestanas, Selector, Tabla, Td, Th, TituloPanel, TONO_PROVEEDOR, Vacio, type Tono } from '../components/ui';
import { api, puede, useDatos, type FilaCoste, type FilaReposicion, type MetricasProveedor, type Reposicion, type Urgencia } from '../lib/api';
import { useSesion } from '../lib/auth';
import { cant, ETIQUETA_ESTADO_PROVEEDOR, eur, eur0, num, pct, pctSigno, precio } from '../lib/format';
import type { PrecargaPedido } from './Compras';

type Vista = 'reposicion' | 'proveedores' | 'costes';
const URGENCIA: Record<Urgencia, { texto: string; tono: Tono }> = {
  critica: { texto: 'Crítica', tono: 'rojo' }, alta: { texto: 'Pedir ya', tono: 'ambar' }, vigilar: { texto: 'Vigilar', tono: 'marca' },
  ok: { texto: 'Cubierto', tono: 'verde' }, sin_consumo: { texto: 'Sin consumo', tono: 'neutro' },
};
const COLOR = { marca: 'var(--marca)', verde: 'var(--verde)', ambar: 'var(--ambar)', rojo: 'var(--rojo)' };

export function Inteligencia() {
  const [sp, setSp] = useSearchParams();
  const vista = (sp.get('vista') as Vista) || 'reposicion';
  return (
    <>
      <Cabecera titulo="Inteligencia de compras" descripcion="Qué conviene pedir, a quién se le puede confiar un pedido y dónde se están moviendo los costes." />
      <Pestanas valor={vista} onCambio={(v) => setSp(v === 'reposicion' ? {} : { vista: v })}
        opciones={[{ id: 'reposicion', etiqueta: 'Reposición' }, { id: 'proveedores', etiqueta: 'Proveedores' }, { id: 'costes', etiqueta: 'Costes' }]} />
      {vista === 'reposicion' && <VistaReposicion />}
      {vista === 'proveedores' && <VistaProveedores />}
      {vista === 'costes' && <VistaCostes />}
    </>
  );
}

// ---------- Reposición ----------
function VistaReposicion() {
  const { usuario } = useSesion();
  const navegar = useNavigate();
  const r = useDatos((s) => api.get<Reposicion>('/inteligencia/reposicion', undefined, s), []);
  const [filtro, setFiltro] = useState<'accion' | 'todos'>('accion');
  const [detalle, setDetalle] = useState<number | null>(null);
  const puedePedir = puede(usuario?.rol, 'pedidos');

  const crearPedido = (filas: FilaReposicion[], proveedorId: number) => {
    const precarga: PrecargaPedido = {
      proveedor_id: proveedorId,
      lineas: filas.filter((f) => f.proveedor_id === proveedorId && f.cantidad_sugerida > 0).map((f) => ({ producto_id: f.producto_id, cantidad: f.cantidad_sugerida, precio_unitario: f.coste_estandar })),
    };
    navegar('/compras', { state: { nuevo: precarga } });
  };

  return (
    <Carga r={r} esqueleto={<Panel><EsqueletoTabla columnas={9} filas={10} /></Panel>}>
      {(d) => {
        const conAccion = d.filas.filter((f) => f.urgencia === 'critica' || f.urgencia === 'alta' || f.urgencia === 'vigilar');
        const aPedir = d.filas.filter((f) => f.cantidad_sugerida > 0);
        const visibles = filtro === 'accion' ? conAccion : d.filas;
        const cuenta = (u: Urgencia) => d.filas.filter((f) => f.urgencia === u).length;
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-linea bg-linea lg:grid-cols-4">
              {[
                { k: 'Rotura probable', v: num(cuenta('critica')), t: cuenta('critica') ? 'text-rojo' : '', n: 'Sin stock o sin cobertura hasta la entrega' },
                { k: 'Bajo el punto de pedido', v: num(cuenta('alta')), t: cuenta('alta') ? 'text-ambar' : '', n: 'Conviene lanzar el pedido hoy' },
                { k: 'Bajo mínimo con pedido en camino', v: num(cuenta('vigilar')), t: '', n: 'Vigilar que la entrega llegue' },
                { k: 'Importe sugerido', v: eur0(aPedir.reduce((s, f) => s + f.importe_sugerido, 0)), t: '', n: `${aPedir.length} productos, a coste estándar` },
              ].map((x) => (
                <div key={x.k} className="bg-panel px-4 py-3.5"><p className="text-[13px] text-tenue">{x.k}</p><p className={cx('cifra titulo mt-1 text-[26px] leading-none', x.t)}>{x.v}</p><p className="mt-1.5 text-xs text-tenue">{x.n}</p></div>
              ))}
            </div>

            <Panel>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-linea p-3">
                <div className="min-w-0"><label className="sr-only" htmlFor="filtro-repo">Productos mostrados</label>
                  <Selector id="filtro-repo" value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} className="w-64">
                    <option value="accion">Solo los que requieren acción ({conAccion.length})</option><option value="todos">Todos los productos ({d.filas.length})</option>
                  </Selector></div>
                <p className="text-[13px] text-tenue">Pulsa una fila para ver el cálculo.</p>
              </div>
              {visibles.length === 0 ? <Vacio titulo="Ningún producto requiere reposición" texto="La posición de inventario de todos los productos está por encima de su punto de pedido." accion={<Boton onClick={() => setFiltro('todos')}>Ver todos los productos</Boton>} /> : (
                <Tabla minimo={1180}>
                  <thead><tr><Th>Producto</Th><Th>Urgencia</Th><Th der>Stock</Th><Th der>En camino</Th><Th der>Consumo/día</Th><Th der>Plazo</Th><Th der>Seguridad</Th><Th der>Punto de pedido</Th><Th der>Cobertura</Th><Th der>Pedir</Th><Th der>Importe</Th><Th /></tr></thead>
                  <tbody>
                    {visibles.map((f) => (
                      <FilaRepo key={f.producto_id} f={f} abierta={detalle === f.producto_id} onAlternar={() => setDetalle(detalle === f.producto_id ? null : f.producto_id)} parametros={d.parametros}
                        onPedir={puedePedir && f.proveedor_id && f.cantidad_sugerida > 0 ? () => crearPedido(d.filas, f.proveedor_id!) : undefined} />
                    ))}
                  </tbody>
                </Tabla>
              )}
            </Panel>

            <Panel>
              <TituloPanel>Cómo se calcula</TituloPanel>
              <div className="grid gap-x-8 gap-y-3 px-4 py-4 md:grid-cols-2">
                <dl className="space-y-2">
                  {[
                    ['Consumo diario (d)', 'Media de las salidas de los últimos 90 días, contando los días sin consumo.'],
                    ['Plazo (L)', 'Plazo real medio del proveedor preferente en el último año; si aún no hay entregas, el plazo acordado.'],
                    ['Stock de seguridad', `z · σ · √L, con z = ${num(d.parametros.z, 2)} (nivel de servicio cercano al 95 %) y σ la desviación diaria del consumo.`],
                  ].map(([k, v]) => <div key={k}><dt className="font-medium">{k}</dt><dd className="text-tenue">{v}</dd></div>)}
                </dl>
                <dl className="space-y-2">
                  {[
                    ['Punto de pedido', 'd · L + stock de seguridad, y nunca por debajo del stock mínimo del producto.'],
                    ['Cuándo pedir', 'Cuando stock + en camino cae hasta el punto de pedido o por debajo.'],
                    ['Cantidad', `La necesaria para cubrir el plazo más ${d.parametros.diasCobertura} días de consumo, redondeada hacia arriba al lote de compra.`],
                  ].map(([k, v]) => <div key={k}><dt className="font-medium">{k}</dt><dd className="text-tenue">{v}</dd></div>)}
                </dl>
              </div>
            </Panel>
          </div>
        );
      }}
    </Carga>
  );
}

function FilaRepo({ f, abierta, onAlternar, onPedir, parametros }: { f: FilaReposicion; abierta: boolean; onAlternar: () => void; onPedir?: () => void; parametros: Reposicion['parametros'] }) {
  const u = URGENCIA[f.urgencia];
  return (
    <>
      <Fila onAbrir={onAlternar} marca={f.urgencia === 'critica' ? 'rojo' : f.urgencia === 'alta' ? 'ambar' : undefined}>
        <Td><p className="font-medium">{f.nombre}</p><p className="text-[13px] text-tenue"><span className="cifra">{f.sku}</span>{f.proveedor && `, ${f.proveedor}`}</p></Td>
        <Td><Insignia tono={u.tono}>{u.texto}</Insignia></Td>
        <Td der><span className={cx('font-medium', f.stock < f.stock_minimo && 'text-ambar')}>{cant(f.stock)}</span></Td>
        <Td der className={f.en_camino ? '' : 'text-tenue'}>{cant(f.en_camino)}</Td>
        <Td der>{num(f.consumo_medio_diario, 1)}</Td>
        <Td der>{num(f.plazo_dias, 1)} d</Td>
        <Td der>{num(f.stock_seguridad)}</Td>
        <Td der>{num(f.punto_pedido)}</Td>
        <Td der>{f.dias_cobertura === null ? '—' : `${num(f.dias_cobertura)} d`}</Td>
        <Td der className="font-medium">{f.cantidad_sugerida > 0 ? `${cant(f.cantidad_sugerida)} ${f.unidad}` : <span className="font-normal text-tenue">—</span>}</Td>
        <Td der>{f.importe_sugerido > 0 ? eur(f.importe_sugerido) : <span className="text-tenue">—</span>}</Td>
        <Td der>{onPedir && <Boton pequeno onClick={(e) => { e.stopPropagation(); onPedir(); }} title={`Abre un pedido a ${f.proveedor} con todas sus líneas sugeridas`}><ShoppingCart size={14} />Crear pedido</Boton>}</Td>
      </Fila>
      {abierta && (
        <tr className="bg-panel2">
          <td colSpan={12} className="border-b border-linea/70 px-4 py-3">
            <p className="font-medium">{f.motivo}</p>
            <p className="cifra mt-1 max-w-[110ch] text-[13px] text-tenue">
              Seguridad = {num(parametros.z, 2)} × {num(f.sigma_diaria, 2)} × √{num(f.plazo_dias, 1)} = {num(f.stock_seguridad, 1)}.{' '}
              Punto de pedido = máx({num(f.consumo_medio_diario, 1)} × {num(f.plazo_dias, 1)} + {num(f.stock_seguridad, 1)}; mínimo {cant(f.stock_minimo)}) = {num(f.punto_pedido, 1)}.{' '}
              Posición = {cant(f.stock)} + {cant(f.en_camino)} = {cant(f.posicion_inventario)}.{' '}
              {f.cantidad_sugerida > 0
                ? `Objetivo = ${num(f.consumo_medio_diario, 1)} × (${num(f.plazo_dias, 1)} + ${parametros.diasCobertura}) + ${num(f.stock_seguridad, 1)}; faltan ${num(Math.max(f.consumo_medio_diario * (f.plazo_dias + parametros.diasCobertura) + f.stock_seguridad, f.stock_minimo) - f.posicion_inventario, 1)}, que en lotes de ${cant(f.lote_compra)} son ${cant(f.cantidad_sugerida)}.`
                : 'La posición supera el punto de pedido: no hace falta pedir.'}
              {' '}Plazo {f.plazo_es_real ? 'real medido en entregas' : 'acordado (sin entregas recientes)'}.
              {f.proveedor_estado && f.proveedor_estado !== 'activo' && ` El proveedor está en estado «${ETIQUETA_ESTADO_PROVEEDOR[f.proveedor_estado]}»: no admite pedidos nuevos.`}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------- Proveedores ----------
function VistaProveedores() {
  const r = useDatos((s) => api.get<MetricasProveedor[]>('/inteligencia/proveedores', undefined, s), []);
  return (
    <Carga r={r} esqueleto={<Panel><EsqueletoTabla columnas={8} /></Panel>}>
      {(todos) => {
        const conPedidos = todos.filter((p) => p.pedidos > 0);
        if (conPedidos.length === 0) return <Panel><Vacio titulo="Sin pedidos que analizar" texto="El rendimiento aparece cuando hay pedidos enviados y recibidos." /></Panel>;
        const porOtd = [...conPedidos].filter((p) => p.otd !== null).sort((a, b) => (a.otd ?? 0) - (b.otd ?? 0));
        const peor = porOtd[0];
        return (
          <div className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel>
                <TituloPanel extra={<span className="text-[13px] text-tenue">Objetivo 85 %</span>}>Entregas puntuales</TituloPanel>
                <div className="px-2 pt-3 pb-2" style={{ height: Math.max(220, porOtd.length * 34 + 50) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={porOtd} layout="vertical" margin={{ top: 0, right: 24, left: 4, bottom: 0 }}>
                      <CartesianGrid horizontal={false} stroke="var(--linea)" strokeDasharray="2 4" />
                      <XAxis type="number" domain={[0, 1]} tickFormatter={(v) => pct(v)} tickLine={false} axisLine={{ stroke: 'var(--linea)' }} />
                      <YAxis type="category" dataKey="codigo" width={64} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{ fill: 'var(--panel2)' }} content={<CajaTooltip titulo={() => null} filas={(p: MetricasProveedor) => [[p.nombre, ''], ['Puntuales', pct(p.otd)], ['Completados', num(p.completados)]]} />} />
                      <ReferenceLine x={0.85} stroke="var(--tenue)" strokeDasharray="4 3" />
                      <Bar dataKey="otd" radius={[0, 3, 3, 0]} maxBarSize={18} isAnimationActive={false}>
                        {porOtd.map((p) => <Cell key={p.proveedor_id} fill={COLOR[tonoOtd(p.otd)]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
              <Panel>
                <TituloPanel extra={<span className="text-[13px] text-tenue">Días, real frente a acordado</span>}>Plazo de entrega</TituloPanel>
                <ul className="space-y-3 px-4 py-4">
                  {[...conPedidos].filter((p) => p.plazo_real !== null).sort((a, b) => (b.plazo_real! - b.plazo_acordado) - (a.plazo_real! - a.plazo_acordado)).map((p) => {
                    const max = Math.max(...conPedidos.map((x) => Math.max(x.plazo_real ?? 0, x.plazo_acordado)));
                    const exceso = p.plazo_real! - p.plazo_acordado;
                    return (
                      <li key={p.proveedor_id}>
                        <div className="mb-1 flex items-baseline justify-between gap-3">
                          <span className="truncate">{p.nombre}</span>
                          <span className="cifra shrink-0"><span className="font-medium">{num(p.plazo_real, 1)}</span> <span className="text-tenue">/ {p.plazo_acordado}</span> <span className={exceso > 1 ? 'text-rojo' : exceso > 0.4 ? 'text-ambar' : 'text-verde'}>{exceso > 0 ? '+' : '−'}{num(Math.abs(exceso), 1)}</span></span>
                        </div>
                        <div className="relative">
                          <Barra valor={p.plazo_real! / max} tono={exceso > 1 ? 'rojo' : exceso > 0.4 ? 'ambar' : 'verde'} />
                          <span className="absolute -top-1 h-3.5 w-0.5 bg-tinta" style={{ left: `${(p.plazo_acordado / max) * 100}%` }} title="Plazo acordado" aria-hidden />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            </div>

            {peor && peor.otd !== null && peor.otd < 0.7 && (
              <p className="rounded-lg border border-linea bg-panel px-4 py-3 shadow-[inset_3px_0_0_var(--rojo)]">
                <span className="font-medium">{peor.nombre}</span> entrega a tiempo solo el {pct(peor.otd)} de sus pedidos, con {num(peor.retraso_medio, 1)} días de retraso medio.
                Sus productos necesitan más stock de seguridad o un proveedor alternativo.
              </p>
            )}

            <Panel>
              <TituloPanel extra={<span className="hidden text-[13px] text-tenue sm:inline">Puntuación: 60 % puntualidad, 25 % calidad, 15 % magnitud del retraso</span>}>Rendimiento por proveedor</TituloPanel>
              <Tabla minimo={980}>
                <thead><tr><Th>Proveedor</Th><Th>Estado</Th><Th der>Pedidos</Th><Th der>Gasto</Th><Th der>Puntuales</Th><Th der>Retraso medio</Th><Th der>Plazo real / acordado</Th><Th der>Rechazo</Th><Th className="w-40">Puntuación</Th></tr></thead>
                <tbody>
                  {[...conPedidos].sort((a, b) => (b.puntuacion ?? -1) - (a.puntuacion ?? -1)).map((p) => (
                    <tr key={p.proveedor_id}>
                      <Td><p className="font-medium">{p.nombre}</p><p className="cifra text-[13px] text-tenue">{p.codigo}</p></Td>
                      <Td><Insignia tono={TONO_PROVEEDOR[p.estado]}>{ETIQUETA_ESTADO_PROVEEDOR[p.estado]}</Insignia></Td>
                      <Td der>{num(p.pedidos)}</Td>
                      <Td der>{eur0(p.gasto)}</Td>
                      <Td der className={cx('font-medium', claseTono[tonoOtd(p.otd)])}>{pct(p.otd)}</Td>
                      <Td der>{p.retraso_medio === null ? '—' : `${num(p.retraso_medio, 1)} d`}</Td>
                      <Td der>{p.plazo_real === null ? '—' : num(p.plazo_real, 1)} / {p.plazo_acordado} d</Td>
                      <Td der>{pct(p.tasa_rechazo, 2)}</Td>
                      <Td><div className="flex items-center gap-2"><Barra className="flex-1" valor={(p.puntuacion ?? 0) / 100} tono={tonoPuntuacion(p.puntuacion)} /><span className="cifra w-7 text-right font-medium">{p.puntuacion ?? '—'}</span></div></Td>
                    </tr>
                  ))}
                </tbody>
              </Tabla>
            </Panel>
          </div>
        );
      }}
    </Carga>
  );
}

// ---------- Costes ----------
function VistaCostes() {
  const r = useDatos((s) => api.get<FilaCoste[]>('/inteligencia/costes', undefined, s), []);
  const [orden, setOrden] = useState<'gasto' | 'variacion' | 'desviacion'>('gasto');
  const ordenadas = useMemo(() => {
    const f = [...(r.datos ?? [])];
    if (orden === 'variacion') f.sort((a, b) => (b.variacion_precio ?? -9) - (a.variacion_precio ?? -9));
    else if (orden === 'desviacion') f.sort((a, b) => (b.desviacion_estandar ?? -9) - (a.desviacion_estandar ?? -9));
    return f;
  }, [r.datos, orden]);

  return (
    <Carga r={r} esqueleto={<Panel><EsqueletoTabla columnas={7} filas={12} /></Panel>}>
      {(filas) => {
        if (filas.length === 0) return <Panel><Vacio titulo="Sin compras en los últimos 12 meses" /></Panel>;
        const total = filas.reduce((s, f) => s + f.gasto_12m, 0);
        const suben = filas.filter((f) => (f.variacion_precio ?? 0) > 0.03);
        // Impacto anual estimado si se mantiene la subida: variación × gasto de 12 meses.
        const impacto = suben.reduce((s, f) => s + f.gasto_12m * (f.variacion_precio ?? 0), 0);
        const mayor = [...filas].filter((f) => f.variacion_precio !== null).sort((a, b) => b.variacion_precio! - a.variacion_precio!)[0];
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-linea bg-linea lg:grid-cols-4">
              {[
                { k: 'Gasto de los últimos 12 meses', v: eur0(total), n: `${filas.length} productos comprados` },
                { k: 'Productos que suben más de un 3 %', v: num(suben.length), n: 'Últimos 90 días frente a los 90 anteriores', t: suben.length ? 'text-ambar' : '' },
                { k: 'Sobrecoste anual estimado', v: eur0(impacto), n: 'Si las subidas se mantienen un año', t: impacto > 0 ? 'text-rojo' : '' },
                { k: 'Mayor subida', v: mayor ? pctSigno(mayor.variacion_precio) : '—', n: mayor?.nombre ?? '', t: mayor && mayor.variacion_precio! > 0.03 ? 'text-rojo' : '' },
              ].map((x) => (
                <div key={x.k} className="min-w-0 bg-panel px-4 py-3.5"><p className="text-[13px] text-tenue">{x.k}</p><p className={cx('cifra titulo mt-1 text-[26px] leading-none', x.t)}>{x.v}</p><p className="mt-1.5 truncate text-xs text-tenue">{x.n}</p></div>
              ))}
            </div>
            <Panel>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-linea p-3">
                <div><label className="sr-only" htmlFor="orden-costes">Ordenar por</label>
                  <Selector id="orden-costes" value={orden} onChange={(e) => setOrden(e.target.value as typeof orden)} className="w-64">
                    <option value="gasto">Ordenar por gasto</option><option value="variacion">Ordenar por subida de precio</option><option value="desviacion">Ordenar por desviación del estándar</option>
                  </Selector></div>
                <p className="text-[13px] text-tenue">Precios medios ponderados por cantidad.</p>
              </div>
              <Tabla minimo={1000}>
                <thead><tr><Th>Producto</Th><Th>Categoría</Th><Th der>Gasto 12 m</Th><Th className="w-32">Peso</Th><Th der>Precio medio</Th><Th der>Estándar</Th><Th der>Frente al estándar</Th><Th der>Variación 90 d</Th></tr></thead>
                <tbody>
                  {ordenadas.map((f) => {
                    const v = f.variacion_precio, dv = f.desviacion_estandar;
                    return (
                      <tr key={f.producto_id} className={v !== null && v > 0.05 ? 'shadow-[inset_3px_0_0_var(--rojo)]' : ''}>
                        <Td><p className="font-medium">{f.nombre}</p><p className="cifra text-[13px] text-tenue">{f.sku}</p></Td>
                        <Td>{f.categoria}</Td>
                        <Td der>{eur0(f.gasto_12m)}</Td>
                        <Td><div className="flex items-center gap-2"><Barra className="flex-1" valor={f.gasto_12m / filas[0].gasto_12m} /><span className="cifra w-10 text-right text-[13px] text-tenue">{pct(f.gasto_12m / total, 1)}</span></div></Td>
                        <Td der>{precio(f.precio_medio_12m)}</Td>
                        <Td der className="text-tenue">{precio(f.coste_estandar)}</Td>
                        <Td der className={dv !== null && Math.abs(dv) > 0.03 ? (dv > 0 ? 'text-rojo' : 'text-verde') : ''}>{pctSigno(dv)}</Td>
                        <Td der>
                          {v === null ? <span className="text-tenue">—</span> : (
                            <span className={cx('inline-flex items-center justify-end gap-1 font-medium', v > 0.03 ? 'text-rojo' : v < -0.03 ? 'text-verde' : 'font-normal text-tinta')}>
                              {v > 0.03 ? <TrendingUp size={14} aria-hidden /> : v < -0.03 ? <TrendingDown size={14} aria-hidden /> : null}{pctSigno(v)}
                            </span>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Tabla>
            </Panel>
          </div>
        );
      }}
    </Carga>
  );
}
