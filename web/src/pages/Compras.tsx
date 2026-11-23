import { Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Barra } from '../components/graficos';
import {
  AreaTexto, AvisoError, Boton, Cabecera, Campo, Carga, Dialogo, Entrada, EsqueletoTabla, Fila, Filtro, Insignia, Paginacion, Panel, Selector,
  Tabla, Td, Th, TONO_PEDIDO, useAviso, Vacio,
} from '../components/ui';
import { api, puede, useDatos, useRetardo, type Almacen, type Pagina, type PedidoDetalle, type PedidoResumen, type Producto, type Proveedor } from '../lib/api';
import { useSesion } from '../lib/auth';
import { ETIQUETA_ESTADO_PEDIDO, eur, fecha, hoyMas, isoLocal } from '../lib/format';
import { useFormulario } from '../lib/formulario';

export interface PrecargaPedido { proveedor_id: number; lineas: { producto_id: number; cantidad: number; precio_unitario: number }[] }

export function Compras() {
  const { usuario } = useSesion();
  const navegar = useNavigate();
  const lugar = useLocation();
  const [sp] = useSearchParams();
  const [f, setF] = useState({ estado: sp.get('estado') ?? '', proveedor_id: '', buscar: '' });
  const [pagina, setPagina] = useState(1);
  const q = useRetardo(f.buscar);
  const r = useDatos((s) => api.get<Pagina<PedidoResumen>>('/pedidos', { estado: f.estado, proveedor_id: f.proveedor_id, buscar: q, pagina, tamano: 50 }, s), [f.estado, f.proveedor_id, q, pagina]);
  const proveedores = useDatos((s) => api.get<Proveedor[]>('/proveedores', undefined, s), []);
  const [nuevo, setNuevo] = useState<PrecargaPedido | 'vacio' | null>(null);
  const cambiar = (c: Partial<typeof f>) => { setF({ ...f, ...c }); setPagina(1); };

  // Llegada desde Inteligencia con líneas sugeridas: se abre el formulario y se limpia el estado de navegación.
  useEffect(() => {
    const pre = (lugar.state as { nuevo?: PrecargaPedido } | null)?.nuevo;
    if (pre) { setNuevo(pre); navegar(lugar.pathname + lugar.search, { replace: true, state: null }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Cabecera titulo="Compras" descripcion="Pedidos a proveedores, su recepción y los que van fuera de plazo."
        acciones={puede(usuario?.rol, 'pedidos') && <Boton variante="primario" onClick={() => setNuevo('vacio')}><Plus size={16} />Nuevo pedido</Boton>} />
      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-linea p-3">
          <Filtro etiqueta="Buscar pedido">{(id) => (
            <div className="relative w-full sm:w-72">
              <Search size={15} className="pointer-events-none absolute left-2.5 top-2.5 text-tenue" aria-hidden />
              <Entrada id={id} type="search" placeholder="Número o proveedor" value={f.buscar} onChange={(e) => cambiar({ buscar: e.target.value })} className="pl-8" />
            </div>)}</Filtro>
          <Filtro etiqueta="Estado">{(id) => (
            <Selector id={id} value={f.estado} onChange={(e) => cambiar({ estado: e.target.value })} className="sm:w-48">
              <option value="">Todos los estados</option>{Object.entries(ETIQUETA_ESTADO_PEDIDO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Selector>)}</Filtro>
          <Filtro etiqueta="Proveedor">{(id) => (
            <Selector id={id} value={f.proveedor_id} onChange={(e) => cambiar({ proveedor_id: e.target.value })} className="sm:w-64">
              <option value="">Todos los proveedores</option>{proveedores.datos?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </Selector>)}</Filtro>
        </div>
        <Carga r={r} esqueleto={<EsqueletoTabla columnas={7} filas={12} />}>
          {(d) => d.filas.length === 0
            ? <Vacio titulo="Ningún pedido coincide" texto={f.estado || f.proveedor_id || f.buscar ? 'Cambia la búsqueda o los filtros.' : 'Crea el primer pedido de compra.'} />
            : (
              <>
                <Tabla minimo={940}>
                  <thead><tr><Th>Pedido</Th><Th>Proveedor</Th><Th>Almacén</Th><Th>Fecha</Th><Th>Entrega prevista</Th><Th className="w-40">Recibido</Th><Th der>Importe</Th><Th>Estado</Th></tr></thead>
                  <tbody>
                    {d.filas.map((p) => (
                      <Fila key={p.id} onAbrir={() => navegar(`/compras/${p.id}`)} marca={p.retrasado ? 'rojo' : undefined}>
                        <Td className="whitespace-nowrap"><span className="cifra font-medium">{p.numero}</span> <span className="text-[13px] text-tenue">{p.lineas} {p.lineas === 1 ? 'línea' : 'líneas'}</span></Td>
                        <Td className="max-w-[240px] truncate">{p.proveedor}</Td>
                        <Td className="whitespace-nowrap">{p.almacen}</Td>
                        <Td className="cifra whitespace-nowrap">{fecha(p.fecha_pedido)}</Td>
                        <Td className="cifra whitespace-nowrap">{fecha(p.fecha_entrega_prevista)}{p.retrasado && <span className="ml-2"><Insignia tono="rojo">Fuera de plazo</Insignia></span>}</Td>
                        <Td>
                          {p.estado === 'borrador' || p.estado === 'cancelado' ? <span className="text-tenue">—</span> : (
                            <div className="flex items-center gap-2"><Barra className="flex-1" valor={p.pct_recibido / 100} tono={p.pct_recibido >= 100 ? 'verde' : 'marca'} /><span className="cifra w-11 text-right text-[13px]">{Math.round(p.pct_recibido)} %</span></div>
                          )}
                        </Td>
                        <Td der>{eur(p.importe)}</Td>
                        <Td><Insignia tono={TONO_PEDIDO[p.estado]}>{ETIQUETA_ESTADO_PEDIDO[p.estado]}</Insignia></Td>
                      </Fila>
                    ))}
                  </tbody>
                </Tabla>
                <Paginacion pagina={d.pagina} tamano={d.tamano} total={d.total} onCambio={setPagina} />
              </>
            )}
        </Carga>
      </Panel>
      {nuevo && <FormularioPedido precarga={nuevo === 'vacio' ? null : nuevo} proveedores={proveedores.datos ?? null} onCerrar={() => setNuevo(null)} onCreado={(p) => navegar(`/compras/${p.id}`)} />}
    </>
  );
}

interface LineaForm { clave: number; producto_id: string; cantidad: string; precio_unitario: string }
let claveLinea = 0;
const lineaVacia = (): LineaForm => ({ clave: ++claveLinea, producto_id: '', cantidad: '', precio_unitario: '' });

function FormularioPedido({ precarga, proveedores, onCerrar, onCreado }: { precarga: PrecargaPedido | null; proveedores: Proveedor[] | null; onCerrar: () => void; onCreado: (p: PedidoDetalle) => void }) {
  const avisar = useAviso();
  const almacenes = useDatos((s) => api.get<Almacen[]>('/inventario/almacenes', undefined, s), []);
  const productos = useDatos((s) => api.get<Producto[]>('/inventario/productos', undefined, s), []);
  const f = useFormulario({ proveedor_id: precarga ? String(precarga.proveedor_id) : '', almacen_id: '', fecha_entrega_prevista: '', notas: precarga ? 'Generado desde la recomendación de reposición.' : '' });
  const [lineas, setLineas] = useState<LineaForm[]>(() => precarga?.lineas.length
    ? precarga.lineas.map((l) => ({ clave: ++claveLinea, producto_id: String(l.producto_id), cantidad: String(l.cantidad), precio_unitario: String(l.precio_unitario) }))
    : [lineaVacia()]);
  const fechaTocada = useRef(false);

  const proveedor = proveedores?.find((p) => String(p.id) === f.v.proveedor_id);
  // Fecha prevista por defecto: hoy + plazo acordado del proveedor (mientras el usuario no la cambie a mano).
  useEffect(() => { if (proveedor && !fechaTocada.current) f.poner('fecha_entrega_prevista', hoyMas(proveedor.plazo_entrega_dias)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [proveedor?.id]);
  useEffect(() => { const a = almacenes.datos?.find((x) => x.activo); if (a && !f.v.almacen_id) f.poner('almacen_id', String(a.id)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [almacenes.datos]);

  const activos = useMemo(() => (productos.datos ?? []).filter((p) => p.activo), [productos.datos]);
  const delProveedor = activos.filter((p) => proveedor && p.proveedor_preferente_id === proveedor.id);
  const otros = activos.filter((p) => !proveedor || p.proveedor_preferente_id !== proveedor.id);
  const porId = useMemo(() => new Map(activos.map((p) => [String(p.id), p])), [activos]);

  const cambiarLinea = (clave: number, c: Partial<LineaForm>) => setLineas((ls) => ls.map((l) => {
    if (l.clave !== clave) return l;
    const n = { ...l, ...c };
    // Al elegir producto se propone su coste estándar como precio.
    if (c.producto_id !== undefined && c.producto_id !== l.producto_id) n.precio_unitario = String(porId.get(c.producto_id)?.coste_estandar ?? '');
    return n;
  }));
  const total = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0), 0);

  const validar = () => {
    const e: Record<string, string> = {};
    if (!f.v.proveedor_id) e.proveedor_id = 'Elige un proveedor';
    if (!f.v.almacen_id) e.almacen_id = 'Elige el almacén de destino';
    if (!f.v.fecha_entrega_prevista) e.fecha_entrega_prevista = 'Indica la fecha prevista';
    else if (f.v.fecha_entrega_prevista < isoLocal(new Date())) e.fecha_entrega_prevista = 'No puede ser anterior a hoy';
    const usados = new Set<string>();
    lineas.forEach((l, i) => {
      if (!l.producto_id) e[`lineas.${i}.producto_id`] = 'Elige un producto';
      else if (usados.has(l.producto_id)) e[`lineas.${i}.producto_id`] = 'Producto repetido';
      usados.add(l.producto_id);
      if (!(Number(l.cantidad) > 0)) e[`lineas.${i}.cantidad`] = 'Mayor que 0';
      if (l.precio_unitario === '' || !(Number(l.precio_unitario) >= 0)) e[`lineas.${i}.precio_unitario`] = 'Indica el precio';
    });
    return e;
  };
  const guardar = async () => {
    let creado: PedidoDetalle | null = null;
    const ok = await f.enviar(async () => {
      creado = await api.post<PedidoDetalle>('/pedidos', {
        proveedor_id: Number(f.v.proveedor_id), almacen_id: Number(f.v.almacen_id), fecha_entrega_prevista: f.v.fecha_entrega_prevista, notas: f.v.notas,
        lineas: lineas.map((l) => ({ producto_id: Number(l.producto_id), cantidad: Number(l.cantidad), precio_unitario: Number(l.precio_unitario) })),
      });
    }, validar);
    if (ok && creado) { avisar(`Pedido ${(creado as PedidoDetalle).numero} creado como borrador`); onCreado(creado); }
  };

  return (
    <Dialogo titulo="Nuevo pedido de compra" subtitulo="Se guarda como borrador; podrás revisarlo antes de enviarlo." onCerrar={onCerrar} ancho="max-w-4xl"
      pie={<><span className="mr-auto">Total <span className="cifra titulo text-lg">{eur(total)}</span></span><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" cargando={f.enviando} onClick={guardar}>Crear pedido</Boton></>}>
      <form onSubmit={(e) => { e.preventDefault(); guardar(); }} noValidate>
        {f.general && <div className="mb-4"><AvisoError>{f.general}</AvisoError></div>}
        <div className="grid gap-x-3 gap-y-4 sm:grid-cols-3">
          <Campo etiqueta="Proveedor" error={f.errores.proveedor_id}>
            {(p) => (
              <Selector {...p} value={f.v.proveedor_id} onChange={(e) => f.poner('proveedor_id', e.target.value)} data-autofoco disabled={!proveedores}>
                <option value="">{proveedores ? 'Elige un proveedor' : 'Cargando…'}</option>
                {proveedores?.filter((x) => x.estado === 'activo' || String(x.id) === f.v.proveedor_id).map((x) => <option key={x.id} value={x.id}>{x.nombre}{x.estado !== 'activo' ? ' (no activo)' : ''}</option>)}
              </Selector>)}
          </Campo>
          <Campo etiqueta="Almacén de destino" error={f.errores.almacen_id}>
            {(p) => <Selector {...p} value={f.v.almacen_id} onChange={(e) => f.poner('almacen_id', e.target.value)}><option value="">Elige un almacén</option>{almacenes.datos?.filter((a) => a.activo).map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</Selector>}
          </Campo>
          <Campo etiqueta="Entrega prevista" error={f.errores.fecha_entrega_prevista} ayuda={proveedor ? `Plazo acordado: ${proveedor.plazo_entrega_dias} días` : undefined}>
            {(p) => <Entrada {...p} type="date" min={isoLocal(new Date())} value={f.v.fecha_entrega_prevista} onChange={(e) => { fechaTocada.current = true; f.poner('fecha_entrega_prevista', e.target.value); }} />}
          </Campo>
        </div>
        {proveedor && proveedor.estado !== 'activo' && <div className="mt-3"><AvisoError>Este proveedor no está activo: el servidor rechazará el pedido hasta que se reactive.</AvisoError></div>}

        <h3 className="titulo mt-6 mb-2 text-[15px]">Líneas</h3>
        <div className="space-y-2">
          {lineas.map((l, i) => {
            const prod = porId.get(l.producto_id);
            const eP = f.errores[`lineas.${i}.producto_id`], eC = f.errores[`lineas.${i}.cantidad`], eU = f.errores[`lineas.${i}.precio_unitario`];
            return (
              <div key={l.clave} className="grid grid-cols-[1fr_1fr_auto] items-start gap-2 rounded-md border border-linea p-2 sm:grid-cols-[minmax(0,1fr)_120px_130px_110px_auto] sm:border-0 sm:p-0">
                <div className="col-span-3 sm:col-span-1">
                  <label className="sr-only" htmlFor={`lp-${l.clave}`}>Producto de la línea {i + 1}</label>
                  <Selector id={`lp-${l.clave}`} value={l.producto_id} aria-invalid={eP ? true : undefined} onChange={(e) => cambiarLinea(l.clave, { producto_id: e.target.value })} disabled={!productos.datos}>
                    <option value="">{productos.datos ? 'Elige un producto' : 'Cargando…'}</option>
                    {delProveedor.length > 0 && <optgroup label={`Habituales de ${proveedor!.nombre}`}>{delProveedor.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.nombre}</option>)}</optgroup>}
                    <optgroup label={delProveedor.length ? 'Resto del catálogo' : 'Catálogo'}>{otros.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.nombre}</option>)}</optgroup>
                  </Selector>
                  {eP && <p role="alert" className="mt-1 text-[13px] text-rojo">{eP}</p>}
                </div>
                <div>
                  <label className="sr-only" htmlFor={`lc-${l.clave}`}>Cantidad de la línea {i + 1}</label>
                  <Entrada id={`lc-${l.clave}`} type="number" min={0} step="any" placeholder={prod ? `Cant. (${prod.unidad})` : 'Cantidad'} value={l.cantidad} aria-invalid={eC ? true : undefined} onChange={(e) => cambiarLinea(l.clave, { cantidad: e.target.value })} className="text-right" />
                  {eC && <p role="alert" className="mt-1 text-[13px] text-rojo">{eC}</p>}
                </div>
                <div>
                  <label className="sr-only" htmlFor={`lu-${l.clave}`}>Precio unitario de la línea {i + 1}</label>
                  <Entrada id={`lu-${l.clave}`} type="number" min={0} step="0.0001" placeholder="Precio €" value={l.precio_unitario} aria-invalid={eU ? true : undefined} onChange={(e) => cambiarLinea(l.clave, { precio_unitario: e.target.value })} className="text-right" />
                  {eU && <p role="alert" className="mt-1 text-[13px] text-rojo">{eU}</p>}
                </div>
                <p className="cifra hidden h-9 items-center justify-end sm:flex">{eur((Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0))}</p>
                <Boton variante="fantasma" aria-label={`Quitar línea ${i + 1}`} disabled={lineas.length === 1} onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}><Trash2 size={16} /></Boton>
              </div>
            );
          })}
        </div>
        {f.errores.lineas && <p role="alert" className="mt-2 text-[13px] text-rojo">{f.errores.lineas}</p>}
        <Boton className="mt-3" onClick={() => setLineas((ls) => [...ls, lineaVacia()])}><Plus size={15} />Añadir línea</Boton>

        <Campo etiqueta="Notas para el proveedor (opcional)" error={f.errores.notas} className="mt-5">{(p) => <AreaTexto {...p} rows={2} value={f.v.notas} onChange={(e) => f.poner('notas', e.target.value)} />}</Campo>
        <button type="submit" hidden />
      </form>
    </Dialogo>
  );
}
