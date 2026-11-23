import { useState, type FormEvent } from 'react';
import { AvisoError, Boton, Campo, Entrada } from '../components/ui';
import { ErrorApi } from '../lib/api';
import { useSesion } from '../lib/auth';

export function Login() {
  const { entrar } = useSesion();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null); setEnviando(true);
    try { await entrar(email.trim(), password); }
    catch (err) {
      const ea = err as ErrorApi;
      setError(ea.codigo === 'VALIDACION' ? 'Escribe un correo electrónico válido y tu contraseña.' : ea.message);
      setEnviando(false);
    }
  }

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
        <form onSubmit={enviar} className="w-full max-w-sm" noValidate>
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-9 place-items-center rounded-md bg-marca text-sm font-bold text-sobre-marca">BF</span>
            <span className="titulo text-lg">BusinessFlow Intelligence</span>
          </div>
          <h1 className="titulo text-2xl">Inicia sesión</h1>
          <p className="mt-1 mb-6 text-tenue">Accede con la cuenta de tu empresa.</p>
          <div className="space-y-4">
            {error && <AvisoError>{error}</AvisoError>}
            <Campo etiqueta="Correo electrónico">
              {(p) => <Entrada {...p} type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Campo>
            <Campo etiqueta="Contraseña">
              {(p) => <Entrada {...p} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Campo>
            <Boton type="submit" variante="primario" className="w-full" cargando={enviando} disabled={!email || !password}>Entrar</Boton>
          </div>
        </form>
      </div>
    </div>
  );
}
