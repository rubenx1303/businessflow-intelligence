import { ArrowLeft, Ban, PackageCheck, Send } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Barra } from '../components/graficos';
import { AreaTexto, AvisoError, Boton, Campo, Carga, cx, Dialogo, Entrada, Esqueleto, Insignia, Panel, Tabla, Td, Th, TituloPanel, TONO_PEDIDO, useAviso } from '../components/ui';
import { api, ErrorApi, puede, useDatos, type PedidoDetalle as Pedido } from '../lib/api';
import { useSesion } from '../lib/auth';
import { cant, ETIQUETA_ESTADO_PEDIDO, eur, fecha, isoLocal, precio } from '../lib/format';
import { useFormulario } from '../lib/formulario';

export function PedidoDetalle() {
  const { id } = useParams();
  const { usuario } = useSesion();
  const avisar = useAviso();
  const r = useDatos((s) => api.get<Pedido>(`/pedidos/${id}`, undefined, s), [id]);
  const [accion, setAccion] = useState<'enviar' | 'cancelar' | null>(null);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  const [recibir, setRecibir] = useState(false);

  async function transicion(a: 'enviar' | 'cancelar') {
    setAccion(a);
    try { await api.post(`/pedidos/${id}/${a}`); avisar(a === 'enviar' ? 'Pedido enviado al proveedor' : 'Pedido cancelado'); r.recargar(); }
    catch (e) { avisar((e as ErrorApi).message, 'error'); }
    finally { setAccion(null); setConfirmarCancelar(false); }
  }

  return (
    <>
      <Link to="/compras" className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-tenue hover:text-tinta"><ArrowLeft size={14} />Todos los pedidos</Link>
      <Carga r={r} esqueleto={<div className="space-y-4" role="status" aria-label="Cargando pedido"><Esqueleto className="h-8 w-64" /><Esqueleto className="h-24 w-full" /><Esqueleto className="h-64 w-full" /></div>}>
        {(p) => {
          const hoy = isoLocal(new Date());
          const abierto = p.estado === 'enviado' || p.estado === 'parcial';
          const tarde = abierto && p.fecha_entrega_prevista < hoy;
          const pedido = p.lineas.reduce((s, l) => s + l.cantidad, 0), recibido = p.lineas.reduce((s, l) => s + Math.min(l.recibido, l.cantidad), 0);
          const puedePedidos = puede(usuario?.rol, 'pedidos');
          return (
            <>
              <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h1 className="titulo cifra text-2xl leading-tight">{p.numero}</h1>
                    <Insignia tono={TONO_PEDIDO[p.estado]}>{ETIQUETA_ESTADO_PEDIDO[p.estado]}</Insignia>
                    {tarde && <Insignia tono="rojo">Fuera de plazo</Insignia>}
                  </div>
                  <p className="mt-0.5 text-tenue">{p.proveedor}, con destino {p.almacen}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {puedePedidos && (p.estado === 'borrador' || p.estado === 'enviado') && <Boton variante="peligro" onClick={() => setConfirmarCancelar(true)}><Ban size={15} />Cancelar pedido</Boton>}
                  {puedePedidos && p.estado === 'borrador' && <Boton variante="primario" cargando={accion === 'enviar'} onClick={() => transicion('enviar')}><Send size={15} />Enviar al proveedor</Boton>}
                  {abierto && puede(usuario?.rol, 'recepciones') && <Boton variante="primario" onClick={() => setRecibir(true)}><PackageCheck size={16} />Registrar recepción</Boton>}
                </div>
              </header>

              <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-linea bg-linea lg:grid-cols-4">
                {[['Fecha del pedido', fecha(p.fecha_pedido)], ['Entrega prevista', fecha(p.fecha_entrega_prevista)], ['Importe', eur(p.importe)]].map(([k, v], i) => (
                  <div key={k} className="bg-panel px-4 py-3"><p className="text-[13px] text-tenue">{k}</p><p className={cx('cifra titulo mt-0.5 text-lg', i === 1 && tarde && 'text-rojo')}>{v}</p></div>
                ))}
                <div className="bg-panel px-4 py-3">
                  <p className="text-[13px] text-tenue">Recibido</p>
                  <p className="cifra titulo mt-0.5 text-lg">{pedido > 0 ? Math.round(100 * recibido / pedido) : 0} %</p>
                  <Barra className="mt-1.5" valor={pedido > 0 ? recibido / pedido : 0} tono={recibido >= pedido ? 'verde' : 'marca'} />
                </div>
              </div>
              {p.notas && <p className="mb-4 rounded-md border border-linea bg-panel px-4 py-2.5 text-tenue">{p.notas}</p>}

              <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <Panel>
                  <TituloPanel>Líneas del pedido</TituloPanel>
                  <Tabla minimo={640}>
                    <thead><tr><Th>Producto</Th><Th der>Pedido</Th><Th der>Recibido</Th><Th der>Rechazado</Th><Th der>Pendiente</Th><Th der>Precio</Th><Th der>Importe</Th></tr></thead>
                    <tbody>
                      {p.lineas.map((l) => (
                        <tr key={l.id}>
                          <Td><p>{l.producto}</p><p className="cifra text-[13px] text-tenue">{l.sku}</p></Td>
                          <Td der>{cant(l.cantidad)} <span className="text-tenue">{l.unidad}</span></Td>
                          <Td der className={l.recibido > 0 ? 'text-verde' : 'text-tenue'}>{cant(l.recibido)}</Td>
                          <Td der className={l.rechazado > 0 ? 'text-rojo' : 'text-tenue'}>{cant(l.rechazado)}</Td>
                          <Td der className={cx('font-medium', l.pendiente > 0 && abierto ? 'text-ambar' : 'text-tenue')}>{cant(l.pendiente)}</Td>
                          <Td der>{precio(l.precio_unitario)}</Td>
                          <Td der>{eur(l.importe)}</Td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr><Td colSpan={6} className="text-right font-medium">Total</Td><Td der className="font-medium">{eur(p.importe)}</Td></tr></tfoot>
                  </Tabla>
                </Panel>

                <Panel>
                  <TituloPanel>Recepciones</TituloPanel>
                  {p.recepciones.length === 0
                    ? <p className="px-4 py-8 text-center text-tenue">{p.estado === 'borrador' ? 'Envía el pedido al proveedor para poder recibirlo.' : p.estado === 'cancelado' ? 'Pedido cancelado sin recepciones.' : 'Todavía no ha llegado mercancía de este pedido.'}</p>
                    : (
                      <ol className="divide-y divide-linea/70">
                        {p.recepciones.map((rc) => {
                          const tardia = rc.fecha_recepcion > p.fecha_entrega_prevista;
                          return (
                            <li key={rc.id} className="px-4 py-3">
                              <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <p className="cifra font-medium">{rc.albaran}</p>
                                <p className={cx('cifra text-[13px]', tardia ? 'text-rojo' : 'text-tenue')}>{fecha(rc.fecha_recepcion)}{tardia && ', tarde'}</p>
                              </div>
                              <ul className="mt-1.5 space-y-0.5 text-[13px]">
                                {(rc.lineas ?? []).map((x) => {
                                  const l = p.lineas.find((y) => y.id === x.linea_pedido_id);
                                  return (
                                    <li key={x.linea_pedido_id} className="flex justify-between gap-3">
                                      <span className="truncate text-tenue">{l?.producto ?? `Línea ${x.linea_pedido_id}`}</span>
                                      <span className="cifra shrink-0">{cant(x.recibida)} {l?.unidad}{x.rechazada > 0 && <span className="text-rojo">, {cant(x.rechazada)} rechazadas</span>}</span>
                                    </li>
                                  );
                                })}
                              </ul>
                              {rc.notas && <p className="mt-1.5 text-[13px] text-tenue">{rc.notas}</p>}
                            </li>
                          );
                        })}
                      </ol>
                    )}
                </Panel>
              </div>

              {confirmarCancelar && (
                <Dialogo titulo={`¿Cancelar el pedido ${p.numero}?`} onCerrar={() => setConfirmarCancelar(false)} ancho="max-w-md"
                  pie={<><Boton onClick={() => setConfirmarCancelar(false)}>Volver</Boton><Boton variante="peligro" cargando={accion === 'cancelar'} onClick={() => transicion('cancelar')}>Cancelar pedido</Boton></>}>
                  <p>El pedido quedará cancelado y no admitirá recepciones. Esta acción no se puede deshacer.</p>
                </Dialogo>
              )}
              {recibir && <FormularioRecepcion pedido={p} onCerrar={() => setRecibir(false)} onGuardado={() => { setRecibir(false); r.recargar(); }} />}
            </>
          );
        }}
      </Carga>
    </>
  );
}

function FormularioRecepcion({ pedido, onCerrar, onGuardado }: { pedido: Pedido; onCerrar: () => void; onGuardado: () => void }) {
  const avisar = useAviso();
  const pendientes = pedido.lineas.filter((l) => l.pendiente > 0);
  const f = useFormulario({ albaran: '', fecha_recepcion: isoLocal(new Date()), notas: '' });
  // Por defecto se recibe todo lo pendiente: lo habitual es que el albarán llegue completo.
  const [cantidades, setCantidades] = useState<Record<number, { recibida: string; rechazada: string }>>(
    () => Object.fromEntries(pendientes.map((l) => [l.id, { recibida: String(l.pendiente), rechazada: '0' }])));
  const poner = (id: number, c: Partial<{ recibida: string; rechazada: string }>) => setCantidades((x) => ({ ...x, [id]: { ...x[id], ...c } }));
  const totalRecibido = pendientes.reduce((s, l) => s + (Number(cantidades[l.id].recibida) || 0), 0);
  const quedara = pendientes.reduce((s, l) => s + l.pendiente, 0) - totalRecibido;

  const validar = () => {
    const e: Record<string, string> = {};
    if (!f.v.albaran.trim()) e.albaran = 'Indica el número de albarán';
    if (!f.v.fecha_recepcion) e.fecha_recepcion = 'Indica la fecha';
    else if (f.v.fecha_recepcion > isoLocal(new Date())) e.fecha_recepcion = 'No puede ser futura';
    else if (f.v.fecha_recepcion < pedido.fecha_pedido) e.fecha_recepcion = 'No puede ser anterior al pedido';
    let alguna = false;
    for (const l of pendientes) {
      const rec = Number(cantidades[l.id].recibida || 0), rech = Number(cantidades[l.id].rechazada || 0);
      if (!(rec >= 0) || !(rech >= 0)) e[`l${l.id}`] = 'Cantidades no válidas';
      else if (rec > l.pendiente) e[`l${l.id}`] = `Solo quedan ${cant(l.pendiente)} pendientes`;
      if (rec + rech > 0) alguna = true;
    }
    if (!alguna) e.lineas = 'Indica al menos una cantidad recibida o rechazada';
    return e;
  };
  const guardar = async () => {
    const ok = await f.enviar(() => api.post(`/pedidos/${pedido.id}/recepciones`, {
      albaran: f.v.albaran, fecha_recepcion: f.v.fecha_recepcion, notas: f.v.notas,
      lineas: pendientes.map((l) => ({ linea_pedido_id: l.id, cantidad_recibida: Number(cantidades[l.id].recibida || 0), cantidad_rechazada: Number(cantidades[l.id].rechazada || 0) })),
    }), validar);
    if (ok) { avisar(quedara > 0 ? 'Recepción parcial registrada' : 'Recepción registrada: pedido completo'); onGuardado(); }
  };

  return (
    <Dialogo titulo="Registrar recepción" subtitulo={<span><span className="cifra">{pedido.numero}</span>, {pedido.proveedor}</span>} onCerrar={onCerrar} ancho="max-w-3xl"
      pie={<><span className="mr-auto text-[13px] text-tenue">{quedara > 0 ? `Quedarán ${cant(quedara)} unidades pendientes` : 'El pedido quedará completo'}</span><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" cargando={f.enviando} onClick={guardar}>Registrar recepción</Boton></>}>
      <form onSubmit={(e) => { e.preventDefault(); guardar(); }} noValidate>
        {f.general && <div className="mb-4"><AvisoError>{f.general}</AvisoError></div>}
        <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2">
          <Campo etiqueta="Número de albarán" error={f.errores.albaran}>{(p) => <Entrada {...p} maxLength={40} value={f.v.albaran} onChange={(e) => f.poner('albaran', e.target.value)} data-autofoco />}</Campo>
          <Campo etiqueta="Fecha de recepción" error={f.errores.fecha_recepcion}>{(p) => <Entrada {...p} type="date" min={pedido.fecha_pedido} max={isoLocal(new Date())} value={f.v.fecha_recepcion} onChange={(e) => f.poner('fecha_recepcion', e.target.value)} />}</Campo>
        </div>

        <h3 className="titulo mt-6 mb-2 text-[15px]">Cantidades por línea</h3>
        <div className="overflow-hidden rounded-lg border border-linea">
          <Tabla minimo={560}>
            <thead><tr><Th>Producto</Th><Th der>Pendiente</Th><Th der className="w-32">Recibida</Th><Th der className="w-32">Rechazada</Th></tr></thead>
            <tbody>
              {pendientes.map((l) => (
                <tr key={l.id}>
                  <Td><p>{l.producto}</p><p className="cifra text-[13px] text-tenue">{l.sku}</p>{f.errores[`l${l.id}`] && <p role="alert" className="text-[13px] text-rojo">{f.errores[`l${l.id}`]}</p>}</Td>
                  <Td der>{cant(l.pendiente)} <span className="text-tenue">{l.unidad}</span></Td>
                  <Td><label className="sr-only" htmlFor={`rr-${l.id}`}>Cantidad recibida de {l.producto}</label>
                    <Entrada id={`rr-${l.id}`} type="number" min={0} max={l.pendiente} step="any" className="text-right" aria-invalid={f.errores[`l${l.id}`] ? true : undefined} value={cantidades[l.id].recibida} onChange={(e) => poner(l.id, { recibida: e.target.value })} /></Td>
                  <Td><label className="sr-only" htmlFor={`rj-${l.id}`}>Cantidad rechazada de {l.producto}</label>
                    <Entrada id={`rj-${l.id}`} type="number" min={0} step="any" className="text-right" value={cantidades[l.id].rechazada} onChange={(e) => poner(l.id, { rechazada: e.target.value })} /></Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        </div>
        {f.errores.lineas && <p role="alert" className="mt-2 text-[13px] text-rojo">{f.errores.lineas}</p>}
        <p className="mt-2 text-[13px] text-tenue">Solo la cantidad recibida entra en stock. La rechazada queda anotada y sigue pendiente de reposición por el proveedor.</p>
        <Campo etiqueta="Notas (opcional)" error={f.errores.notas} className="mt-4">{(p) => <AreaTexto {...p} rows={2} value={f.v.notas} onChange={(e) => f.poner('notas', e.target.value)} placeholder="Incidencias, daños, bultos…" />}</Campo>
        <button type="submit" hidden />
      </form>
    </Dialogo>
  );
}
