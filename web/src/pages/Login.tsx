import { ArrowRight, Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AvisoError, Boton, Campo, Entrada } from '../components/ui';
import { ErrorApi, type Rol } from '../lib/api';
import { useSesion } from '../lib/auth';

const ACCESOS: { rol: Rol; titulo: string; puede: string }[] = [
  { rol: 'admin', titulo: 'Administración', puede: 'Todo: proveedores, productos, pedidos, stock, auditoría y restaurar la demo.' },
  { rol: 'compras', titulo: 'Compras', puede: 'Crea y edita proveedores y productos, lanza pedidos y registra recepciones.' },
  { rol: 'almacen', titulo: 'Almacén', puede: 'Registra recepciones, salidas y ajustes de stock. No crea pedidos.' },
  { rol: 'lectura', titulo: 'Dirección (solo lectura)', puede: 'Consulta el panel, los informes y los datos sin modificar nada.' },
];

export function Login() {
  const { entrar, entrarDemo, demo } = useSesion();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<'form' | Rol | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null); setEnviando('form');
    try { await entrar(email.trim(), password); }
    catch (err) {
      const ea = err as ErrorApi;
      setError(ea.codigo === 'VALIDACION' ? 'Escribe un correo electrónico válido y tu contraseña.' : ea.message);
      setEnviando(null);
    }
  }
  async function demoComo(rol: Rol) {
    setError(null); setEnviando(rol);
    try { await entrarDemo(rol); } catch (err) { setError((err as ErrorApi).message); setEnviando(null); }
  }

  const formulario = (
    <form onSubmit={enviar} noValidate className="space-y-4">
      <Campo etiqueta="Correo electrónico">
        {(p) => <Entrada {...p} type="email" autoComplete="username" required autoFocus={demo === false} value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Campo>
      <Campo etiqueta="Contraseña">
        {(p) => <Entrada {...p} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Campo>
      <Boton type="submit" variante={demo ? 'secundario' : 'primario'} className="w-full" cargando={enviando === 'form'} disabled={!email || !password || enviando !== null}>Entrar</Boton>
    </form>
  );

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      {/* Lado de marca: el libro de movimientos como motivo, no una ilustración genérica. */}
      <div className="relative hidden overflow-hidden bg-marca text-sobre-marca lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-md bg-sobre-marca text-sm font-bold text-marca">BF</span>
          <span className="titulo text-lg">BusinessFlow Intelligence</span>
        </div>
        <div>
          <p className="titulo max-w-[18ch] text-5xl leading-[1.05]">Cada pedido, cada albarán, cada unidad de stock.</p>
          <p className="mt-5 max-w-[46ch] text-base opacity-85">Compras, recepciones e inventario en un único libro de movimientos, con indicadores que explican qué está pasando y qué conviene pedir.</p>
        </div>
        <table className="cifra w-full max-w-md text-[13px] opacity-80" aria-hidden>
          <tbody>
            {[['PC-2026-0412', 'Entrada por compra', '+240'], ['ALM-VLC', 'Salida a clientes', '−86'], ['DES-002', 'Bajo mínimo', '17 / 36'], ['PRV-005', 'Retraso medio', '2,3 días']].map((f) => (
              <tr key={f[0]} className="border-t border-current/20">
                <td className="py-1.5 pr-4 font-medium">{f[0]}</td><td className="py-1.5">{f[1]}</td><td className="py-1.5 text-right">{f[2]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-9 place-items-center rounded-md bg-marca text-sm font-bold text-sobre-marca">BF</span>
            <span className="titulo text-lg">BusinessFlow Intelligence</span>
          </div>

          {demo ? (
            <>
              <h1 className="titulo text-2xl">Entra a la demostración</h1>
              <p className="mt-1 text-tenue">Elige un perfil para ver la aplicación con sus permisos. No hace falta contraseña.</p>
              <p className="mt-3 mb-4 rounded-md bg-ambar-suave px-3 py-2 text-[13px] text-ambar">
                Demo local con datos ficticios: la empresa, los proveedores y las operaciones son inventados y se pueden restaurar en cualquier momento.
              </p>
              {error && <div className="mb-3"><AvisoError>{error}</AvisoError></div>}
              <ul className="overflow-hidden rounded-lg border border-linea bg-panel">
                {ACCESOS.map((a) => (
                  <li key={a.rol} className="border-b border-linea/70 last:border-0">
                    <button type="button" disabled={enviando !== null} onClick={() => demoComo(a.rol)} aria-label={`Entrar como ${a.titulo}`}
                      className="group flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-panel2 disabled:opacity-60">
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">Entrar como {a.titulo}</span>
                        <span className="block text-[13px] text-tenue">{a.puede}</span>
                      </span>
                      {enviando === a.rol ? <Loader2 size={17} className="shrink-0 animate-spin text-marca" aria-hidden />
                        : <ArrowRight size={17} className="shrink-0 text-tenue transition-transform group-hover:translate-x-0.5 group-hover:text-marca" aria-hidden />}
                    </button>
                  </li>
                ))}
              </ul>
              <h2 className="mt-7 mb-3 border-t border-linea pt-5 text-[13px] font-medium text-tenue">O entra con correo y contraseña</h2>
              {formulario}
            </>
          ) : (
            <>
              <h1 className="titulo text-2xl">Inicia sesión</h1>
              <p className="mt-1 mb-6 text-tenue">Accede con la cuenta de tu empresa.</p>
              {error && <div className="mb-4"><AvisoError>{error}</AvisoError></div>}
              {formulario}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
