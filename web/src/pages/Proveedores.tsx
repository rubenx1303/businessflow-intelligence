import { Pencil, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { claseTono, tonoOtd, tonoPuntuacion } from '../components/graficos';
import {
  AreaTexto, AvisoError, Boton, Cabecera, Campo, Carga, cx, Dialogo, Entrada, EsqueletoTabla, Fila, Filtro, Insignia, Panel, Selector,
  Tabla, Td, Th, TONO_PEDIDO, TONO_PROVEEDOR, useAviso, Vacio,
} from '../components/ui';
import { api, puede, useDatos, useRetardo, type Historial, type Proveedor } from '../lib/api';
import { useSesion } from '../lib/auth';
import { ETIQUETA_ESTADO_PEDIDO, ETIQUETA_ESTADO_PROVEEDOR, eur, eur0, fecha, fechaHora, num, pct } from '../lib/format';
import { useFormulario } from '../lib/formulario';

export function Proveedores() {
  const { usuario } = useSesion();
  const editable = puede(usuario?.rol, 'proveedores');
  const [buscar, setBuscar] = useState('');
  const [estado, setEstado] = useState('');
  const q = useRetardo(buscar);
  const r = useDatos((s) => api.get<Proveedor[]>('/proveedores', { buscar: q, estado }, s), [q, estado]);
  const [form, setForm] = useState<Proveedor | 'nuevo' | null>(null);
  const [ficha, setFicha] = useState<Proveedor | null>(null);

  return (
    <>
      <Cabecera titulo="Proveedores" descripcion="Alta, estado y rendimiento de cada proveedor."
        acciones={editable && <Boton variante="primario" onClick={() => setForm('nuevo')}><Plus size={16} />Nuevo proveedor</Boton>} />

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-linea p-3">
          <Filtro etiqueta="Buscar proveedor">{(id) => (
            <div className="relative w-full sm:w-80">
              <Search size={15} className="pointer-events-none absolute left-2.5 top-2.5 text-tenue" aria-hidden />
              <Entrada id={id} type="search" placeholder="Nombre, código, CIF o ciudad" value={buscar} onChange={(e) => setBuscar(e.target.value)} className="pl-8" />
            </div>)}</Filtro>
          <Filtro etiqueta="Estado">{(id) => (
            <Selector id={id} value={estado} onChange={(e) => setEstado(e.target.value)} className="sm:w-44">
              <option value="">Todos los estados</option>
              {Object.entries(ETIQUETA_ESTADO_PROVEEDOR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Selector>)}</Filtro>
          {r.datos && <span className="cifra ml-auto text-[13px] text-tenue">{r.datos.length} {r.datos.length === 1 ? 'proveedor' : 'proveedores'}</span>}
        </div>
        <Carga r={r} esqueleto={<EsqueletoTabla columnas={6} />}>
          {(filas) => filas.length === 0
            ? <Vacio titulo="Ningún proveedor coincide" texto={buscar || estado ? 'Prueba con otra búsqueda o quita el filtro de estado.' : 'Da de alta el primer proveedor para empezar a registrar pedidos.'}
                accion={editable && !buscar && !estado ? <Boton variante="primario" onClick={() => setForm('nuevo')}><Plus size={16} />Nuevo proveedor</Boton> : undefined} />
            : (
              <Tabla minimo={860}>
                <thead><tr><Th>Proveedor</Th><Th>CIF</Th><Th>Ciudad</Th><Th der>Plazo</Th><Th>Pago</Th><Th der>Pedidos abiertos</Th><Th>Estado</Th><Th /></tr></thead>
                <tbody>
                  {filas.map((p) => (
                    <Fila key={p.id} onAbrir={() => setFicha(p)}>
                      <Td><p className="font-medium">{p.nombre}</p><p className="cifra text-[13px] text-tenue">{p.codigo}</p></Td>
                      <Td className="cifra">{p.cif}</Td>
                      <Td>{p.ciudad ?? '—'}</Td>
                      <Td der>{p.plazo_entrega_dias} d</Td>
                      <Td>{p.condiciones_pago}</Td>
                      <Td der>{p.pedidos_abiertos || '—'}</Td>
                      <Td><Insignia tono={TONO_PROVEEDOR[p.estado]}>{ETIQUETA_ESTADO_PROVEEDOR[p.estado]}</Insignia></Td>
                      <Td der>{editable && <Boton variante="fantasma" pequeno aria-label={`Editar ${p.nombre}`} onClick={(e) => { e.stopPropagation(); setForm(p); }}><Pencil size={15} /></Boton>}</Td>
                    </Fila>
                  ))}
                </tbody>
              </Tabla>
            )}
        </Carga>
      </Panel>

      {form && <FormularioProveedor proveedor={form === 'nuevo' ? null : form} onCerrar={() => setForm(null)} onGuardado={() => { setForm(null); r.recargar(); }} />}
      {ficha && <FichaProveedor proveedor={ficha} onCerrar={() => setFicha(null)} onEditar={editable ? () => { setForm(ficha); setFicha(null); } : undefined} />}
    </>
  );
}

function FormularioProveedor({ proveedor, onCerrar, onGuardado }: { proveedor: Proveedor | null; onCerrar: () => void; onGuardado: () => void }) {
  const avisar = useAviso();
  const f = useFormulario({
    codigo: proveedor?.codigo ?? '', nombre: proveedor?.nombre ?? '', cif: proveedor?.cif ?? '', email: proveedor?.email ?? '',
    telefono: proveedor?.telefono ?? '', ciudad: proveedor?.ciudad ?? '', pais: proveedor?.pais ?? 'España',
    plazo_entrega_dias: String(proveedor?.plazo_entrega_dias ?? 7), condiciones_pago: proveedor?.condiciones_pago ?? '30 días',
    estado: proveedor?.estado ?? 'activo', notas: proveedor?.notas ?? '',
  });
  const validar = () => {
    const e: Record<string, string> = {};
    if (!f.v.codigo.trim()) e.codigo = 'Indica un código';
    else if (!/^[A-Z0-9-]+$/.test(f.v.codigo.trim())) e.codigo = 'Solo mayúsculas, números y guiones';
    if (!f.v.nombre.trim()) e.nombre = 'Indica el nombre o razón social';
    if (!/^[A-Z0-9]{8,12}$/i.test(f.v.cif.trim())) e.cif = 'El CIF/NIF debe tener entre 8 y 12 letras o números';
    if (f.v.email && !/^\S+@\S+\.\S+$/.test(f.v.email.trim())) e.email = 'El correo no es válido';
    const plazo = Number(f.v.plazo_entrega_dias);
    if (f.v.plazo_entrega_dias === '' || !Number.isInteger(plazo) || plazo < 0 || plazo > 365) e.plazo_entrega_dias = 'Entre 0 y 365 días';
    return e;
  };
  const guardar = async () => {
    const ok = await f.enviar(async () => {
      const cuerpo = { ...f.v, plazo_entrega_dias: Number(f.v.plazo_entrega_dias) };
      if (proveedor) await api.put(`/proveedores/${proveedor.id}`, cuerpo); else await api.post('/proveedores', cuerpo);
    }, validar);
    if (ok) { avisar(proveedor ? 'Proveedor guardado' : 'Proveedor creado'); onGuardado(); }
  };
  const t = (k: keyof typeof f.v) => ({ value: f.v[k], onChange: (e: { target: { value: string } }) => f.poner(k, e.target.value as never) });

  return (
    <Dialogo lateral titulo={proveedor ? 'Editar proveedor' : 'Nuevo proveedor'} subtitulo={proveedor?.nombre} onCerrar={onCerrar}
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" cargando={f.enviando} onClick={guardar}>{proveedor ? 'Guardar cambios' : 'Crear proveedor'}</Boton></>}>
      <form className="grid grid-cols-2 gap-x-3 gap-y-4" onSubmit={(e) => { e.preventDefault(); guardar(); }} noValidate>
        {f.general && <div className="col-span-2"><AvisoError>{f.general}</AvisoError></div>}
        <Campo etiqueta="Código" error={f.errores.codigo} ayuda="Por ejemplo PRV-010">{(p) => <Entrada {...p} {...t('codigo')} onChange={(e) => f.poner('codigo', e.target.value.toUpperCase())} data-autofoco />}</Campo>
        <Campo etiqueta="CIF / NIF" error={f.errores.cif}>{(p) => <Entrada {...p} {...t('cif')} onChange={(e) => f.poner('cif', e.target.value.toUpperCase())} />}</Campo>
        <Campo etiqueta="Nombre o razón social" error={f.errores.nombre} className="col-span-2">{(p) => <Entrada {...p} {...t('nombre')} />}</Campo>
        <Campo etiqueta="Correo de pedidos" error={f.errores.email} className="col-span-2 sm:col-span-1">{(p) => <Entrada {...p} type="email" {...t('email')} />}</Campo>
        <Campo etiqueta="Teléfono" error={f.errores.telefono} className="col-span-2 sm:col-span-1">{(p) => <Entrada {...p} type="tel" {...t('telefono')} />}</Campo>
        <Campo etiqueta="Ciudad" error={f.errores.ciudad}>{(p) => <Entrada {...p} {...t('ciudad')} />}</Campo>
        <Campo etiqueta="País" error={f.errores.pais}>{(p) => <Entrada {...p} {...t('pais')} />}</Campo>
        <Campo etiqueta="Plazo de entrega acordado (días)" error={f.errores.plazo_entrega_dias}>{(p) => <Entrada {...p} type="number" min={0} max={365} {...t('plazo_entrega_dias')} />}</Campo>
        <Campo etiqueta="Condiciones de pago" error={f.errores.condiciones_pago}>{(p) => <Entrada {...p} {...t('condiciones_pago')} />}</Campo>
        <Campo etiqueta="Estado" error={f.errores.estado} className="col-span-2" ayuda="Solo se pueden crear pedidos a proveedores activos.">
          {(p) => <Selector {...p} {...t('estado')}>{Object.entries(ETIQUETA_ESTADO_PROVEEDOR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Selector>}
        </Campo>
        <Campo etiqueta="Notas" error={f.errores.notas} className="col-span-2">{(p) => <AreaTexto {...p} {...t('notas')} />}</Campo>
        <button type="submit" hidden />
      </form>
    </Dialogo>
  );
}

function Dato({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: keyof typeof claseTono }) {
  return <div className="bg-panel px-3 py-2.5"><p className="text-xs text-tenue">{etiqueta}</p><p className={cx('cifra titulo mt-0.5 text-lg leading-tight', tono && claseTono[tono])}>{valor}</p></div>;
}

function describirCambio(detalle: Historial['cambios'][number]['detalle']): string {
  if (!detalle) return '';
  return Object.entries(detalle).map(([k, v]) =>
    v && typeof v === 'object' && 'antes' in v ? `${k.replaceAll('_', ' ')}: ${(v as any).antes ?? '—'} → ${(v as any).despues ?? '—'}` : `${k.replaceAll('_', ' ')}: ${String(v)}`).join(' · ');
}

function FichaProveedor({ proveedor: p, onCerrar, onEditar }: { proveedor: Proveedor; onCerrar: () => void; onEditar?: () => void }) {
  const r = useDatos((s) => api.get<Historial>(`/proveedores/${p.id}/historial`, undefined, s), [p.id]);
  return (
    <Dialogo lateral ancho="max-w-2xl" titulo={p.nombre} onCerrar={onCerrar}
      subtitulo={<span className="flex flex-wrap items-center gap-2"><span className="cifra">{p.codigo} · {p.cif}</span><Insignia tono={TONO_PROVEEDOR[p.estado]}>{ETIQUETA_ESTADO_PROVEEDOR[p.estado]}</Insignia></span>}
      pie={onEditar && <Boton onClick={onEditar}><Pencil size={15} />Editar proveedor</Boton>}>
      <dl className="mb-5 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3">
        {[['Ciudad', [p.ciudad, p.pais].filter(Boolean).join(', ')], ['Correo', p.email], ['Teléfono', p.telefono], ['Plazo acordado', `${p.plazo_entrega_dias} días`], ['Pago', p.condiciones_pago]].map(([k, v]) => (
          <div key={k as string} className="min-w-0"><dt className="text-tenue">{k}</dt><dd className="truncate">{v || '—'}</dd></div>
        ))}
      </dl>
      {p.notas && <p className="mb-5 rounded-md bg-ambar-suave px-3 py-2 text-ambar">{p.notas}</p>}

      <Carga r={r} esqueleto={<EsqueletoTabla filas={6} columnas={4} />}>
        {(h) => (
          <div className="space-y-6">
            <section>
              <h3 className="titulo mb-2 text-[15px]">Rendimiento histórico</h3>
              {!h.metricas || h.metricas.pedidos === 0 ? <p className="text-tenue">Todavía no hay pedidos con este proveedor.</p> : (
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-linea bg-linea sm:grid-cols-4">
                  <Dato etiqueta="Puntuación" valor={h.metricas.puntuacion === null ? '—' : `${h.metricas.puntuacion} / 100`} tono={tonoPuntuacion(h.metricas.puntuacion)} />
                  <Dato etiqueta="Entregas puntuales" valor={pct(h.metricas.otd)} tono={tonoOtd(h.metricas.otd)} />
                  <Dato etiqueta="Retraso medio" valor={h.metricas.retraso_medio === null ? '—' : `${num(h.metricas.retraso_medio, 1)} días`} />
                  <Dato etiqueta="Plazo real / acordado" valor={`${h.metricas.plazo_real === null ? '—' : num(h.metricas.plazo_real, 1)} / ${h.metricas.plazo_acordado} d`} />
                  <Dato etiqueta="Gasto total" valor={eur0(h.metricas.gasto)} />
                  <Dato etiqueta="Pedidos" valor={num(h.metricas.pedidos)} />
                  <Dato etiqueta="Completados" valor={num(h.metricas.completados)} />
                  <Dato etiqueta="Unidades rechazadas" valor={pct(h.metricas.tasa_rechazo, 2)} />
                </div>
              )}
            </section>

            <section>
              <h3 className="titulo mb-2 text-[15px]">Últimos pedidos</h3>
              {h.pedidos.length === 0 ? <p className="text-tenue">Sin pedidos.</p> : (
                <div className="overflow-hidden rounded-lg border border-linea">
                  <Tabla minimo={520}>
                    <thead><tr><Th>Pedido</Th><Th>Fecha</Th><Th>Previsto</Th><Th>Recibido</Th><Th der>Importe</Th><Th>Estado</Th></tr></thead>
                    <tbody>
                      {h.pedidos.map((x) => {
                        const tarde = x.ultima_recepcion && x.estado === 'recibido' && x.ultima_recepcion > x.fecha_entrega_prevista;
                        return (
                          <tr key={x.id}>
                            <Td><Link to={`/compras/${x.id}`} className="cifra font-medium text-marca hover:underline">{x.numero}</Link></Td>
                            <Td>{fecha(x.fecha_pedido)}</Td><Td>{fecha(x.fecha_entrega_prevista)}</Td>
                            <Td className={tarde ? 'text-rojo' : undefined}>{fecha(x.ultima_recepcion)}</Td>
                            <Td der>{eur(x.importe)}</Td>
                            <Td><Insignia tono={TONO_PEDIDO[x.estado]}>{ETIQUETA_ESTADO_PEDIDO[x.estado]}</Insignia></Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Tabla>
                </div>
              )}
            </section>

            <section>
              <h3 className="titulo mb-2 text-[15px]">Cambios en la ficha</h3>
              {h.cambios.length === 0 ? <p className="text-tenue">Sin cambios registrados.</p> : (
                <ul className="space-y-2">
                  {h.cambios.map((c, i) => (
                    <li key={i} className="border-l-2 border-linea pl-3">
                      <p><span className="font-medium capitalize">{c.accion}</span> <span className="text-tenue">por {c.usuario ?? 'sistema'}, {fechaHora(c.fecha)}</span></p>
                      {c.detalle && <p className="text-[13px] break-words text-tenue">{describirCambio(c.detalle)}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Carga>
    </Dialogo>
  );
}
