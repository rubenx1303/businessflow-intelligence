import { ArrowDownUp, Pencil, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Barra } from '../components/graficos';
import {
  AvisoError, Boton, Cabecera, Campo, Carga, cx, Dialogo, Entrada, EsqueletoTabla, Fila, Filtro, Insignia, Paginacion, Panel, Pestanas, Selector,
  Tabla, Td, Th, useAviso, Vacio, type Tono,
} from '../components/ui';
import { api, puede, useDatos, useRetardo, type Almacen, type Movimiento, type Pagina, type Producto, type Proveedor } from '../lib/api';
import { useSesion } from '../lib/auth';
import { cant, ETIQUETA_TIPO_MOV, eur, eur0, fechaHora, precio } from '../lib/format';
import { useFormulario } from '../lib/formulario';

type Vista = 'existencias' | 'movimientos' | 'almacenes';
const SITUACION: Record<Producto['situacion'], { texto: string; tono: Tono }> = {
  ok: { texto: 'Correcto', tono: 'verde' }, bajo_minimo: { texto: 'Bajo mínimo', tono: 'ambar' }, sin_stock: { texto: 'Sin stock', tono: 'rojo' },
};

export function Inventario() {
  const [sp, setSp] = useSearchParams();
  const vista = (sp.get('vista') as Vista) || 'existencias';
  const almacenes = useDatos((s) => api.get<Almacen[]>('/inventario/almacenes', undefined, s), []);
  return (
    <>
      <Cabecera titulo="Inventario" descripcion="Existencias por producto y almacén, calculadas a partir del libro de movimientos." />
      <Pestanas valor={vista} onCambio={(v) => setSp(v === 'existencias' ? {} : { vista: v })}
        opciones={[{ id: 'existencias', etiqueta: 'Existencias' }, { id: 'movimientos', etiqueta: 'Movimientos' }, { id: 'almacenes', etiqueta: 'Almacenes' }]} />
      {vista === 'existencias' && <Existencias almacenes={almacenes.datos ?? []} />}
      {vista === 'movimientos' && <Movimientos almacenes={almacenes.datos ?? []} />}
      {vista === 'almacenes' && <Almacenes r={almacenes} />}
    </>
  );
}

// ---------- Existencias ----------
function Existencias({ almacenes }: { almacenes: Almacen[] }) {
  const { usuario } = useSesion();
  const editable = puede(usuario?.rol, 'productos');
  const [sp] = useSearchParams();
  const [buscar, setBuscar] = useState(sp.get('buscar') ?? '');
  const [categoria, setCategoria] = useState('');
  const [almacen, setAlmacen] = useState('');
  const [bajo, setBajo] = useState(sp.get('bajo') === '1');
  const q = useRetardo(buscar);
  const r = useDatos((s) => api.get<Producto[]>('/inventario/productos', { buscar: q, categoria, almacen_id: almacen, solo_bajo_minimo: bajo ? 'true' : undefined }, s), [q, categoria, almacen, bajo]);
  const categorias = useDatos((s) => api.get<string[]>('/inventario/categorias', undefined, s), []);
  const [form, setForm] = useState<Producto | 'nuevo' | null>(null);
  const [detalle, setDetalle] = useState<Producto | null>(null);
  const hayFiltros = !!(buscar || categoria || almacen || bajo);

  return (
    <>
      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-linea p-3">
          <Filtro etiqueta="Buscar producto">{(id) => (
            <div className="relative w-full sm:w-72">
              <Search size={15} className="pointer-events-none absolute left-2.5 top-2.5 text-tenue" aria-hidden />
              <Entrada id={id} type="search" placeholder="Nombre o SKU" value={buscar} onChange={(e) => setBuscar(e.target.value)} className="pl-8" />
            </div>)}</Filtro>
          <Filtro etiqueta="Categoría">{(id) => (
            <Selector id={id} value={categoria} onChange={(e) => setCategoria(e.target.value)} className="sm:w-52">
              <option value="">Todas las categorías</option>{categorias.datos?.map((c) => <option key={c}>{c}</option>)}
            </Selector>)}</Filtro>
          <Filtro etiqueta="Almacén">{(id) => (
            <Selector id={id} value={almacen} onChange={(e) => setAlmacen(e.target.value)} className="sm:w-48">
              <option value="">Todos los almacenes</option>{almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </Selector>)}</Filtro>
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-linea px-2.5 select-none hover:bg-panel2">
            <input type="checkbox" checked={bajo} onChange={(e) => setBajo(e.target.checked)} className="size-4 accent-[var(--marca)]" />Solo bajo mínimo
          </label>
          {editable && <Boton variante="primario" className="ml-auto" onClick={() => setForm('nuevo')}><Plus size={16} />Nuevo producto</Boton>}
        </div>
        <Carga r={r} esqueleto={<EsqueletoTabla columnas={7} />}>
          {(filas) => filas.length === 0
            ? <Vacio titulo={bajo && !buscar && !categoria ? 'Ningún producto bajo mínimo' : 'Ningún producto coincide'} texto={hayFiltros ? 'Cambia la búsqueda o los filtros para ver más productos.' : 'Crea el primer producto para empezar a controlar su stock.'} />
            : (
              <>
                <Tabla minimo={900}>
                  <thead><tr><Th>Producto</Th><Th>Categoría</Th><Th der>Stock</Th><Th className="w-40">Frente al mínimo</Th><Th der>Coste estándar</Th><Th der>Valor</Th><Th>Situación</Th><Th /></tr></thead>
                  <tbody>
                    {filas.map((p) => (
                      <Fila key={p.id} onAbrir={() => setDetalle(p)} marca={p.situacion === 'sin_stock' ? 'rojo' : p.situacion === 'bajo_minimo' ? 'ambar' : undefined}>
                        <Td><p className="font-medium">{p.nombre}</p><p className="cifra text-[13px] text-tenue">{p.sku}{!p.activo && ' · inactivo'}</p></Td>
                        <Td>{p.categoria}</Td>
                        <Td der><span className="font-medium">{cant(p.stock)}</span> <span className="text-tenue">{p.unidad}</span></Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <Barra className="flex-1" valor={p.stock_minimo > 0 ? p.stock / (p.stock_minimo * 2) : 1} tono={p.situacion === 'ok' ? 'verde' : p.situacion === 'bajo_minimo' ? 'ambar' : 'rojo'} />
                            <span className="cifra w-12 text-right text-[13px] text-tenue">{cant(p.stock_minimo)}</span>
                          </div>
                        </Td>
                        <Td der>{precio(p.coste_estandar)}</Td>
                        <Td der>{eur(p.valor_stock)}</Td>
                        <Td><Insignia tono={SITUACION[p.situacion].tono}>{SITUACION[p.situacion].texto}</Insignia></Td>
                        <Td der>{editable && <Boton variante="fantasma" pequeno aria-label={`Editar ${p.nombre}`} onClick={(e) => { e.stopPropagation(); setForm(p); }}><Pencil size={15} /></Boton>}</Td>
                      </Fila>
                    ))}
                  </tbody>
                </Tabla>
                <p className="cifra px-4 py-2.5 text-[13px] text-tenue">
                  {filas.length} productos, {eur0(filas.reduce((s, p) => s + p.valor_stock, 0))} en stock{almacen ? ' en este almacén. El mínimo se define para toda la empresa, no por almacén.' : '.'}
                </p>
              </>
            )}
        </Carga>
      </Panel>
      {form && <FormularioProducto producto={form === 'nuevo' ? null : form} categorias={categorias.datos ?? []} onCerrar={() => setForm(null)} onGuardado={() => { setForm(null); r.recargar(); categorias.recargar(); }} />}
      {detalle && <DetalleProducto p={detalle} onCerrar={() => setDetalle(null)} />}
    </>
  );
}

function DetalleProducto({ p, onCerrar }: { p: Producto; onCerrar: () => void }) {
  const r = useDatos((s) => api.get<{ almacen_id: number; almacen: string; stock: number }[]>(`/inventario/productos/${p.id}/existencias`, undefined, s), [p.id]);
  return (
    <Dialogo titulo={p.nombre} subtitulo={<span className="cifra">{p.sku} · {p.categoria}</span>} onCerrar={onCerrar} ancho="max-w-lg">
      <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3">
        {[['Proveedor preferente', p.proveedor_nombre ?? 'Sin asignar'], ['Coste estándar', precio(p.coste_estandar)], ['Stock mínimo', `${cant(p.stock_minimo)} ${p.unidad}`], ['Lote de compra', `${cant(p.lote_compra)} ${p.unidad}`]].map(([k, v]) => (
          <div key={k}><dt className="text-tenue">{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      <h3 className="titulo mb-2 text-[15px]">Existencias por almacén</h3>
      <Carga r={r} esqueleto={<EsqueletoTabla filas={3} columnas={2} />}>
        {(filas) => {
          const total = filas.reduce((s, f) => s + f.stock, 0);
          return (
            <ul className="divide-y divide-linea/70 rounded-lg border border-linea">
              {filas.map((f) => (
                <li key={f.almacen_id} className="px-3 py-2.5">
                  <div className="mb-1 flex justify-between gap-3"><span>{f.almacen}</span><span className="cifra font-medium">{cant(f.stock)} {p.unidad}</span></div>
                  <Barra valor={total > 0 ? f.stock / total : 0} />
                </li>
              ))}
              <li className="flex justify-between gap-3 bg-panel2 px-3 py-2.5 font-medium"><span>Total</span><span className="cifra">{cant(total)} {p.unidad}</span></li>
            </ul>
          );
        }}
      </Carga>
    </Dialogo>
  );
}

function FormularioProducto({ producto, categorias, onCerrar, onGuardado }: { producto: Producto | null; categorias: string[]; onCerrar: () => void; onGuardado: () => void }) {
  const avisar = useAviso();
  const proveedores = useDatos((s) => api.get<Proveedor[]>('/proveedores', undefined, s), []);
  const f = useFormulario({
    sku: producto?.sku ?? '', nombre: producto?.nombre ?? '', categoria: producto?.categoria ?? '', unidad: producto?.unidad ?? 'ud',
    coste_estandar: String(producto?.coste_estandar ?? ''), stock_minimo: String(producto?.stock_minimo ?? '0'), lote_compra: String(producto?.lote_compra ?? '1'),
    proveedor_preferente_id: String(producto?.proveedor_preferente_id ?? ''), activo: producto?.activo ?? true,
  });
  const validar = () => {
    const e: Record<string, string> = {};
    if (!/^[A-Z0-9-]+$/.test(f.v.sku.trim())) e.sku = 'Solo mayúsculas, números y guiones';
    if (!f.v.nombre.trim()) e.nombre = 'Indica el nombre';
    if (!f.v.categoria.trim()) e.categoria = 'Indica la categoría';
    if (!f.v.unidad.trim()) e.unidad = 'Indica la unidad';
    if (f.v.coste_estandar === '' || !(Number(f.v.coste_estandar) >= 0)) e.coste_estandar = 'Indica un coste igual o mayor que 0';
    if (f.v.stock_minimo === '' || !(Number(f.v.stock_minimo) >= 0)) e.stock_minimo = 'Igual o mayor que 0';
    if (!(Number(f.v.lote_compra) > 0)) e.lote_compra = 'Mayor que 0';
    return e;
  };
  const guardar = async () => {
    const ok = await f.enviar(async () => {
      const cuerpo = {
        ...f.v, coste_estandar: Number(f.v.coste_estandar), stock_minimo: Number(f.v.stock_minimo), lote_compra: Number(f.v.lote_compra),
        proveedor_preferente_id: f.v.proveedor_preferente_id ? Number(f.v.proveedor_preferente_id) : null,
      };
      if (producto) await api.put(`/inventario/productos/${producto.id}`, cuerpo); else await api.post('/inventario/productos', cuerpo);
    }, validar);
    if (ok) { avisar(producto ? 'Producto guardado' : 'Producto creado'); onGuardado(); }
  };
  return (
    <Dialogo lateral titulo={producto ? 'Editar producto' : 'Nuevo producto'} subtitulo={producto?.nombre} onCerrar={onCerrar}
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" cargando={f.enviando} onClick={guardar}>{producto ? 'Guardar cambios' : 'Crear producto'}</Boton></>}>
      <form className="grid grid-cols-2 gap-x-3 gap-y-4" onSubmit={(e) => { e.preventDefault(); guardar(); }} noValidate>
        {f.general && <div className="col-span-2"><AvisoError>{f.general}</AvisoError></div>}
        <Campo etiqueta="SKU" error={f.errores.sku}>{(p) => <Entrada {...p} value={f.v.sku} onChange={(e) => f.poner('sku', e.target.value.toUpperCase())} data-autofoco />}</Campo>
        <Campo etiqueta="Unidad" error={f.errores.unidad} ayuda="caja, kg, pack…">{(p) => <Entrada {...p} value={f.v.unidad} onChange={(e) => f.poner('unidad', e.target.value)} />}</Campo>
        <Campo etiqueta="Nombre" error={f.errores.nombre} className="col-span-2">{(p) => <Entrada {...p} value={f.v.nombre} onChange={(e) => f.poner('nombre', e.target.value)} />}</Campo>
        <Campo etiqueta="Categoría" error={f.errores.categoria} className="col-span-2">
          {(p) => <><Entrada {...p} list="lista-categorias" value={f.v.categoria} onChange={(e) => f.poner('categoria', e.target.value)} /><datalist id="lista-categorias">{categorias.map((c) => <option key={c} value={c} />)}</datalist></>}
        </Campo>
        <Campo etiqueta="Coste estándar (€)" error={f.errores.coste_estandar}>{(p) => <Entrada {...p} type="number" min={0} step="0.01" value={f.v.coste_estandar} onChange={(e) => f.poner('coste_estandar', e.target.value)} />}</Campo>
        <Campo etiqueta="Lote de compra" error={f.errores.lote_compra}>{(p) => <Entrada {...p} type="number" min={0} step="any" value={f.v.lote_compra} onChange={(e) => f.poner('lote_compra', e.target.value)} />}</Campo>
        <Campo etiqueta="Stock mínimo" error={f.errores.stock_minimo} className="col-span-2" ayuda="Suma de todos los almacenes. Por debajo, el producto aparece en alertas.">{(p) => <Entrada {...p} type="number" min={0} step="any" value={f.v.stock_minimo} onChange={(e) => f.poner('stock_minimo', e.target.value)} />}</Campo>
        <Campo etiqueta="Proveedor preferente" error={f.errores.proveedor_preferente_id} className="col-span-2">
          {(p) => (
            <Selector {...p} value={f.v.proveedor_preferente_id} onChange={(e) => f.poner('proveedor_preferente_id', e.target.value)}>
              <option value="">Sin asignar</option>{proveedores.datos?.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </Selector>)}
        </Campo>
        <label className="col-span-2 flex cursor-pointer items-center gap-2"><input type="checkbox" checked={f.v.activo} onChange={(e) => f.poner('activo', e.target.checked)} className="size-4 accent-[var(--marca)]" />Producto activo (se puede pedir)</label>
        <button type="submit" hidden />
      </form>
    </Dialogo>
  );
}

// ---------- Movimientos ----------
function Movimientos({ almacenes }: { almacenes: Almacen[] }) {
  const { usuario } = useSesion();
  const [f, setF] = useState({ tipo: '', almacen_id: '', desde: '', hasta: '' });
  const [pagina, setPagina] = useState(1);
  const r = useDatos((s) => api.get<Pagina<Movimiento>>('/inventario/movimientos', { ...f, pagina, tamano: 50 }, s), [f.tipo, f.almacen_id, f.desde, f.hasta, pagina]);
  const [abierto, setAbierto] = useState(false);
  const cambiar = (c: Partial<typeof f>) => { setF({ ...f, ...c }); setPagina(1); };

  return (
    <>
      <Panel>
        <div className="grid grid-cols-2 gap-2 border-b border-linea p-3 sm:flex sm:flex-wrap sm:items-center">
          <Filtro etiqueta="Tipo de movimiento">{(id) => (
            <Selector id={id} value={f.tipo} onChange={(e) => cambiar({ tipo: e.target.value })} className="sm:w-48">
              <option value="">Todos los tipos</option>{Object.entries(ETIQUETA_TIPO_MOV).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Selector>)}</Filtro>
          <Filtro etiqueta="Almacén">{(id) => (
            <Selector id={id} value={f.almacen_id} onChange={(e) => cambiar({ almacen_id: e.target.value })} className="sm:w-48">
              <option value="">Todos los almacenes</option>{almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </Selector>)}</Filtro>
          <Filtro etiqueta="Desde">{(id) => <Entrada id={id} type="date" value={f.desde} onChange={(e) => cambiar({ desde: e.target.value })} className="sm:w-40" />}</Filtro>
          <Filtro etiqueta="Hasta">{(id) => <Entrada id={id} type="date" value={f.hasta} onChange={(e) => cambiar({ hasta: e.target.value })} className="sm:w-40" />}</Filtro>
          {puede(usuario?.rol, 'movimientos') && <Boton variante="primario" className="col-span-2 sm:ml-auto" onClick={() => setAbierto(true)}><ArrowDownUp size={16} />Registrar salida o ajuste</Boton>}
        </div>
        <Carga r={r} esqueleto={<EsqueletoTabla columnas={7} filas={12} />}>
          {(d) => d.filas.length === 0 ? <Vacio titulo="Sin movimientos" texto="Ningún movimiento cumple los filtros elegidos." /> : (
            <>
              <Tabla minimo={880}>
                <thead><tr><Th>Fecha</Th><Th>Tipo</Th><Th>Producto</Th><Th>Almacén</Th><Th der>Cantidad</Th><Th der>Coste unitario</Th><Th>Referencia</Th></tr></thead>
                <tbody>
                  {d.filas.map((m) => (
                    <tr key={m.id}>
                      <Td className="cifra whitespace-nowrap">{fechaHora(m.fecha)}</Td>
                      <Td><Insignia tono={m.tipo === 'ENTRADA_COMPRA' ? 'verde' : m.tipo === 'AJUSTE' ? 'ambar' : 'neutro'}>{ETIQUETA_TIPO_MOV[m.tipo] ?? m.tipo}</Insignia></Td>
                      <Td><p>{m.producto}</p><p className="cifra text-[13px] text-tenue">{m.sku}</p></Td>
                      <Td>{m.almacen}</Td>
                      <Td der className={cx('font-medium', m.cantidad > 0 ? 'text-verde' : 'text-tinta')}>{m.cantidad > 0 ? '+' : '−'}{cant(Math.abs(m.cantidad))} <span className="font-normal text-tenue">{m.unidad}</span></Td>
                      <Td der>{precio(m.coste_unitario)}</Td>
                      <Td className="max-w-[260px] truncate text-tenue">{m.referencia ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Tabla>
              <Paginacion pagina={d.pagina} tamano={d.tamano} total={d.total} onCambio={setPagina} />
            </>
          )}
        </Carga>
      </Panel>
      {abierto && <FormularioMovimiento almacenes={almacenes} onCerrar={() => setAbierto(false)} onGuardado={() => { setAbierto(false); setPagina(1); r.recargar(); }} />}
    </>
  );
}

function FormularioMovimiento({ almacenes, onCerrar, onGuardado }: { almacenes: Almacen[]; onCerrar: () => void; onGuardado: () => void }) {
  const avisar = useAviso();
  const productos = useDatos((s) => api.get<Producto[]>('/inventario/productos', undefined, s), []);
  const f = useFormulario({ tipo: 'SALIDA_CONSUMO', producto_id: '', almacen_id: String(almacenes.find((a) => a.activo)?.id ?? ''), cantidad: '', referencia: '' });
  const existencias = useDatos<{ almacen_id: number; stock: number }[]>(
    (s) => f.v.producto_id ? api.get(`/inventario/productos/${f.v.producto_id}/existencias`, undefined, s) : Promise.resolve([]), [f.v.producto_id]);
  const prod = productos.datos?.find((p) => String(p.id) === f.v.producto_id);
  const disponible = existencias.datos?.find((e) => String(e.almacen_id) === f.v.almacen_id)?.stock;
  const esAjuste = f.v.tipo === 'AJUSTE';
  const n = Number(f.v.cantidad);
  const resultante = disponible !== undefined && f.v.cantidad !== '' && Number.isFinite(n) ? disponible + (esAjuste ? n : -n) : undefined;

  const validar = () => {
    const e: Record<string, string> = {};
    if (!f.v.producto_id) e.producto_id = 'Elige un producto';
    if (!f.v.almacen_id) e.almacen_id = 'Elige un almacén';
    if (f.v.cantidad === '' || !Number.isFinite(n) || n === 0) e.cantidad = 'Indica una cantidad distinta de cero';
    else if (!esAjuste && n < 0) e.cantidad = 'La salida debe ser una cantidad positiva';
    else if (resultante !== undefined && resultante < 0) e.cantidad = `Solo hay ${cant(disponible)} en este almacén`;
    if (esAjuste && !f.v.referencia.trim()) e.referencia = 'Un ajuste requiere indicar el motivo';
    return e;
  };
  const guardar = async () => {
    const ok = await f.enviar(() => api.post('/inventario/movimientos', {
      tipo: f.v.tipo, producto_id: Number(f.v.producto_id), almacen_id: Number(f.v.almacen_id), cantidad: n, referencia: f.v.referencia,
    }), validar);
    if (ok) { avisar(esAjuste ? 'Ajuste registrado' : 'Salida registrada'); onGuardado(); }
  };
  return (
    <Dialogo titulo="Registrar salida o ajuste" subtitulo="Las entradas por compra se generan al recibir un pedido." onCerrar={onCerrar} ancho="max-w-lg"
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" cargando={f.enviando} onClick={guardar}>{esAjuste ? 'Registrar ajuste' : 'Registrar salida'}</Boton></>}>
      <form className="grid grid-cols-2 gap-x-3 gap-y-4" onSubmit={(e) => { e.preventDefault(); guardar(); }} noValidate>
        {f.general && <div className="col-span-2"><AvisoError>{f.general}</AvisoError></div>}
        <Campo etiqueta="Tipo" className="col-span-2">
          {(p) => <Selector {...p} value={f.v.tipo} onChange={(e) => f.poner('tipo', e.target.value)}><option value="SALIDA_CONSUMO">Salida por consumo o venta</option><option value="AJUSTE">Ajuste de inventario (recuento, merma)</option></Selector>}
        </Campo>
        <Campo etiqueta="Producto" error={f.errores.producto_id} className="col-span-2">
          {(p) => (
            <Selector {...p} value={f.v.producto_id} onChange={(e) => f.poner('producto_id', e.target.value)} data-autofoco disabled={!productos.datos}>
              <option value="">{productos.datos ? 'Elige un producto' : 'Cargando productos…'}</option>
              {productos.datos?.map((x) => <option key={x.id} value={x.id}>{x.sku} · {x.nombre}</option>)}
            </Selector>)}
        </Campo>
        <Campo etiqueta="Almacén" error={f.errores.almacen_id}>
          {(p) => <Selector {...p} value={f.v.almacen_id} onChange={(e) => f.poner('almacen_id', e.target.value)}><option value="">Elige un almacén</option>{almacenes.filter((a) => a.activo).map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</Selector>}
        </Campo>
        <Campo etiqueta={esAjuste ? 'Diferencia (+ sobra, − falta)' : `Cantidad que sale${prod ? ` (${prod.unidad})` : ''}`} error={f.errores.cantidad}
          ayuda={disponible !== undefined ? `Disponible: ${cant(disponible)}${resultante !== undefined ? `. Quedará en ${cant(resultante)}` : ''}` : undefined}>
          {(p) => <Entrada {...p} type="number" step="any" value={f.v.cantidad} onChange={(e) => f.poner('cantidad', e.target.value)} />}
        </Campo>
        <Campo etiqueta={esAjuste ? 'Motivo del ajuste' : 'Referencia (opcional)'} error={f.errores.referencia} className="col-span-2">
          {(p) => <Entrada {...p} maxLength={120} value={f.v.referencia} onChange={(e) => f.poner('referencia', e.target.value)} placeholder={esAjuste ? 'Recuento de noviembre, rotura…' : 'Albarán de salida, cliente…'} />}
        </Campo>
        <button type="submit" hidden />
      </form>
    </Dialogo>
  );
}

// ---------- Almacenes ----------
function Almacenes({ r }: { r: ReturnType<typeof useDatos<Almacen[]>> }) {
  const { usuario } = useSesion();
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Panel>
        {puede(usuario?.rol, 'almacenes') && <div className="flex justify-end border-b border-linea p-3"><Boton variante="primario" onClick={() => setAbierto(true)}><Plus size={16} />Nuevo almacén</Boton></div>}
        <Carga r={r} esqueleto={<EsqueletoTabla filas={3} columnas={4} />}>
          {(filas) => {
            const total = filas.reduce((s, a) => s + a.valor_stock, 0);
            return filas.length === 0 ? <Vacio titulo="Sin almacenes" texto="Crea un almacén para poder recibir mercancía." /> : (
              <Tabla minimo={620}>
                <thead><tr><Th>Almacén</Th><Th>Ciudad</Th><Th der>Valor del stock</Th><Th className="w-56">Reparto</Th><Th>Estado</Th></tr></thead>
                <tbody>
                  {filas.map((a) => (
                    <tr key={a.id}>
                      <Td><p className="font-medium">{a.nombre}</p><p className="cifra text-[13px] text-tenue">{a.codigo}</p></Td>
                      <Td>{a.ciudad ?? '—'}</Td>
                      <Td der>{eur(a.valor_stock)}</Td>
                      <Td><div className="flex items-center gap-2"><Barra className="flex-1" valor={total > 0 ? a.valor_stock / total : 0} /><span className="cifra w-10 text-right text-[13px] text-tenue">{total > 0 ? Math.round(100 * a.valor_stock / total) : 0} %</span></div></Td>
                      <Td><Insignia tono={a.activo ? 'verde' : 'neutro'}>{a.activo ? 'Activo' : 'Inactivo'}</Insignia></Td>
                    </tr>
                  ))}
                </tbody>
              </Tabla>
            );
          }}
        </Carga>
      </Panel>
      {abierto && <FormularioAlmacen onCerrar={() => setAbierto(false)} onGuardado={() => { setAbierto(false); r.recargar(); }} />}
    </>
  );
}

function FormularioAlmacen({ onCerrar, onGuardado }: { onCerrar: () => void; onGuardado: () => void }) {
  const avisar = useAviso();
  const f = useFormulario({ codigo: '', nombre: '', ciudad: '' });
  const guardar = async () => {
    const ok = await f.enviar(() => api.post('/inventario/almacenes', f.v), () => {
      const e: Record<string, string> = {};
      if (!/^[A-Z0-9-]+$/.test(f.v.codigo.trim())) e.codigo = 'Solo mayúsculas, números y guiones';
      if (!f.v.nombre.trim()) e.nombre = 'Indica el nombre';
      return e;
    });
    if (ok) { avisar('Almacén creado'); onGuardado(); }
  };
  return (
    <Dialogo titulo="Nuevo almacén" onCerrar={onCerrar} ancho="max-w-md"
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" cargando={f.enviando} onClick={guardar}>Crear almacén</Boton></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); guardar(); }} noValidate>
        {f.general && <AvisoError>{f.general}</AvisoError>}
        <Campo etiqueta="Código" error={f.errores.codigo} ayuda="Por ejemplo ALM-MUR">{(p) => <Entrada {...p} value={f.v.codigo} onChange={(e) => f.poner('codigo', e.target.value.toUpperCase())} data-autofoco />}</Campo>
        <Campo etiqueta="Nombre" error={f.errores.nombre}>{(p) => <Entrada {...p} value={f.v.nombre} onChange={(e) => f.poner('nombre', e.target.value)} />}</Campo>
        <Campo etiqueta="Ciudad" error={f.errores.ciudad}>{(p) => <Entrada {...p} value={f.v.ciudad} onChange={(e) => f.poner('ciudad', e.target.value)} />}</Campo>
        <button type="submit" hidden />
      </form>
    </Dialogo>
  );
}
