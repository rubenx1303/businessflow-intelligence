import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, onSesionCaducada, sesion, type Rol, type Usuario } from './api';

interface Ctx {
  usuario: Usuario | null;
  /** true mientras se comprueba el token guardado al arrancar. */
  comprobando: boolean;
  /** La instancia es una demostración con datos ficticios (null = aún no se sabe). */
  demo: boolean | null;
  entrar: (email: string, password: string) => Promise<void>;
  entrarDemo: (rol: Rol) => Promise<void>;
  salir: () => void;
}
const C = createContext<Ctx>(null!);
export const useSesion = () => useContext(C);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [comprobando, setComprobando] = useState(!!sesion.token());
  const [demo, setDemo] = useState<boolean | null>(null);

  const salir = useCallback(() => { sesion.borrar(); setUsuario(null); }, []);

  useEffect(() => {
    onSesionCaducada(salir);
    api.get<{ demo: boolean }>('/auth/modo').then((m) => setDemo(!!m.demo)).catch(() => setDemo(false));
    if (!sesion.token()) return;
    api.get<Usuario>('/auth/me').then(setUsuario).catch(() => sesion.borrar()).finally(() => setComprobando(false));
  }, [salir]);

  const abrir = useCallback(async (r: { token: string; usuario: Usuario }) => {
    sesion.guardar(r.token);
    // /me añade el nombre de la empresa; si fallara, basta con los datos del login.
    setUsuario(await api.get<Usuario>('/auth/me').catch(() => r.usuario));
  }, []);
  const entrar = useCallback(async (email: string, password: string) => abrir(await api.post('/auth/login', { email, password })), [abrir]);
  const entrarDemo = useCallback(async (rol: Rol) => abrir(await api.post('/auth/demo', { rol })), [abrir]);

  return <C.Provider value={{ usuario, comprobando, demo, entrar, entrarDemo, salir }}>{children}</C.Provider>;
}

export function useTema() {
  const [oscuro, setOscuro] = useState(() => document.documentElement.classList.contains('dark'));
  const alternar = useCallback(() => {
    setOscuro((o) => {
      const n = !o;
      document.documentElement.classList.toggle('dark', n);
      try { localStorage.setItem('bfi-tema', n ? 'oscuro' : 'claro'); } catch { /* sin almacenamiento */ }
      return n;
    });
  }, []);
  return { oscuro, alternar };
}
