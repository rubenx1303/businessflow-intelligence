import { useState } from 'react';
import { Cabecera, Carga, EsqueletoTabla, Filtro, Insignia, Panel, Selector, Tabla, Td, Th, Vacio } from '../components/ui';
import { api, useDatos, type Auditoria as Registro } from '../lib/api';
import { fechaHora } from '../lib/format';

const ENTIDADES = { proveedor: 'Proveedores', producto: 'Productos', almacen: 'Almacenes', pedido: 'Pedidos', movimiento: 'Movimientos de stock', sistema: 'Sistema' };

function resumen(detalle: unknown): string {
  if (!detalle || typeof detalle !== 'object') return '';
  return Object.entries(detalle as Record<string, unknown>).map(([k, v]) => {
    const valor = v && typeof v === 'object' && 'antes' in (v as object) ? `${(v as any).antes ?? '—'} → ${(v as any).despues ?? '—'}` : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `${k.replaceAll('_', ' ')}: ${valor}`;
  }).join('; ');
}

export function Auditoria() {
  const [entidad, setEntidad] = useState('');
  const [limite, setLimite] = useState('100');
  const r = useDatos((s) => api.get<Registro[]>('/auditoria', { entidad, limite }, s), [entidad, limite]);
  return (
    <>
      <Cabecera titulo="Auditoría" descripcion="Quién hizo qué y cuándo: altas, cambios, envíos, recepciones y ajustes de stock." />
      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-linea p-3">
          <Filtro etiqueta="Tipo de registro">{(id) => (
            <Selector id={id} value={entidad} onChange={(e) => setEntidad(e.target.value)} className="sm:w-56">
              <option value="">Todos los registros</option>{Object.entries(ENTIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Selector>)}</Filtro>
          <Filtro etiqueta="Número de registros">{(id) => (
            <Selector id={id} value={limite} onChange={(e) => setLimite(e.target.value)} className="sm:w-44">
              {['100', '250', '500'].map((n) => <option key={n} value={n}>Últimos {n}</option>)}
            </Selector>)}</Filtro>
        </div>
        <Carga r={r} esqueleto={<EsqueletoTabla columnas={5} filas={10} />}>
          {(filas) => filas.length === 0 ? <Vacio titulo="Sin registros" texto="Todavía no hay operaciones de este tipo." /> : (
            <Tabla minimo={820}>
              <thead><tr><Th>Fecha</Th><Th>Usuario</Th><Th>Operación</Th><Th>Registro</Th><Th>Detalle</Th></tr></thead>
              <tbody>
                {filas.map((a) => (
                  <tr key={a.id}>
                    <Td className="cifra whitespace-nowrap">{fechaHora(a.fecha)}</Td>
                    <Td>{a.usuario ?? 'Sistema'}</Td>
                    <Td><Insignia tono={a.accion === 'cancelar' ? 'rojo' : a.accion.includes('ajuste') ? 'ambar' : 'neutro'}>{a.accion.replaceAll('_', ' ')}</Insignia></Td>
                    <Td className="whitespace-nowrap">{ENTIDADES[a.entidad as keyof typeof ENTIDADES] ?? a.entidad}{a.entidad_id && <span className="cifra text-tenue"> n.º {a.entidad_id}</span>}</Td>
                    <Td className="max-w-[420px] text-[13px] break-words text-tenue">{resumen(a.detalle) || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          )}
        </Carga>
      </Panel>
    </>
  );
}
