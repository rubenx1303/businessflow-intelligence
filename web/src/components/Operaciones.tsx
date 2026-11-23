import { Play, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ErrorApi, puede, type Ejecucion } from '../lib/api';
import { useSesion } from '../lib/auth';
import { num } from '../lib/format';
import { AvisoError, Boton, cx, Dialogo, useAviso } from './ui';

/** Segundos transcurridos mientras `activo` es true. */
function useCronometro(activo: boolean) {
  const [seg, setSeg] = useState(0);
  useEffect(() => {
    if (!activo) return;
    setSeg(0);
    const inicio = Date.now();
    const t = setInterval(() => setSeg(Math.floor((Date.now() - inicio) / 1000)), 250);
    return () => clearInterval(t);
  }, [activo]);
  return seg;
}

/** Barra de progreso: estimada si se conoce la duración habitual (se frena al 95 %), indeterminada si no. */
export function Progreso({ seg, estimado, texto }: { seg: number; estimado?: number; texto: string }) {
  const p = estimado ? Math.min(0.95, seg / estimado) : null;
  return (
    <div role="status" aria-live="polite">
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]"><span>{texto}</span><span className="cifra text-tenue">{seg} s</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-linea/70">
        {p === null ? <div className="barra-indeterminada h-full w-1/3 rounded-full bg-marca" />
          : <div className="h-full rounded-full bg-marca transition-[width] duration-300" style={{ width: `${p * 100}%` }} />}
      </div>
    </div>
  );
}

/** Lanza el pipeline local Bronze → Silver → Gold y expone su estado. */
export function usePipeline(alTerminar?: (e: Ejecucion) => void) {
  const avisar = useAviso();
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ultima, setUltima] = useState<Ejecucion | null>(null);
  const seg = useCronometro(enCurso);
  const fin = useRef(alTerminar);
  fin.current = alTerminar;
  const lanzar = useCallback(async () => {
    setEnCurso(true); setError(null);
    try {
      const e = await api.post<Ejecucion>('/datos/pipeline');
      setUltima(e);
      avisar(`Pipeline terminado en ${num(e.duracion_ms.total / 1000, 1)} s`);
      fin.current?.(e);
    } catch (e) {
      setError((e as ErrorApi).message);
    } finally { setEnCurso(false); }
  }, [avisar]);
  return { enCurso, error, ultima, seg, lanzar };
}

export function BotonPipeline({ p, variante = 'primario', className }: { p: ReturnType<typeof usePipeline>; variante?: 'primario' | 'secundario'; className?: string }) {
  const { usuario } = useSesion();
  if (!puede(usuario?.rol, 'pipeline')) return null;
  return <Boton variante={variante} className={className} cargando={p.enCurso} onClick={p.lanzar}>{!p.enCurso && <Play size={15} />}{p.enCurso ? 'Ejecutando…' : 'Ejecutar pipeline'}</Boton>;
}

/** Estado visible del pipeline: progreso mientras corre, error si falla. */
export function EstadoPipeline({ p, className }: { p: ReturnType<typeof usePipeline>; className?: string }) {
  if (p.enCurso) return <div className={className}><Progreso seg={p.seg} texto="Extrayendo a Bronze, limpiando en Silver y reconstruyendo Gold. Suele tardar entre 5 y 30 s." /></div>;
  if (p.error) return <div className={className}><AvisoError>El pipeline no ha terminado: {p.error}</AvisoError></div>;
  return null;
}

/** Restauración de la demo (solo administración, solo en modo demo): confirmación propia, progreso y recarga. */
export function RestaurarDemo({ compacto, plegado }: { compacto?: boolean; plegado?: boolean }) {
  const { usuario, demo } = useSesion();
  const [abierto, setAbierto] = useState(false);
  const [enCurso, setEnCurso] = useState(false);
  const [hecho, setHecho] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seg = useCronometro(enCurso);
  if (!demo || !puede(usuario?.rol, 'restaurar')) return null;

  async function restaurar() {
    setEnCurso(true); setError(null);
    try {
      await api.post('/datos/restaurar-demo');
      setHecho(true);
      // Todo ha cambiado (pedidos, stock, lake): se recarga la aplicación entera para no mostrar nada antiguo.
      setTimeout(() => window.location.reload(), 900);
    } catch (e) { setError((e as ErrorApi).message); setEnCurso(false); }
  }

  return (
    <>
      <Boton variante={compacto ? 'fantasma' : 'peligro'} className={cx(compacto && 'w-full', compacto && !plegado && 'justify-start')} onClick={() => { setError(null); setAbierto(true); }}
        aria-label="Restaurar demo" title={plegado ? 'Restaurar demo' : undefined}>
        <RotateCcw size={compacto ? 17 : 15} />{!plegado && 'Restaurar demo'}
      </Boton>
      {abierto && (
        <Dialogo titulo="¿Restaurar la demo?" ancho="max-w-md" onCerrar={() => { if (!enCurso) setAbierto(false); }}
          pie={!enCurso && !hecho && <><Boton onClick={() => setAbierto(false)} data-autofoco>Cancelar</Boton><Boton variante="peligro" onClick={restaurar}>Restaurar demo</Boton></>}>
          {hecho ? <p role="status" className="font-medium text-verde">Demo restaurada. Recargando la aplicación…</p>
            : enCurso ? <Progreso seg={seg} estimado={40} texto="Regenerando los datos ficticios y reconstruyendo Bronze, Silver y Gold." />
              : (
                <div className="space-y-3">
                  {error && <AvisoError>{error}</AvisoError>}
                  <p>Se borran todas las operaciones ficticias creadas desde el inicio (pedidos, recepciones, movimientos, altas y cambios) y la aplicación vuelve a su estado inicial.</p>
                  <p className="text-tenue">Después se vacía el lake local y se ejecuta el pipeline completo. Tarda unos 40 segundos y no se puede deshacer.</p>
                </div>
              )}
        </Dialogo>
      )}
    </>
  );
}
