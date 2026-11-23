import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, onSesionCaducada, sesion, type Usuario } from './api';

interface Ctx {
  usuario: Usuario | null;
  /** true mientras se comprueba el token guardado al arrancar. */
  comprobando: boolean;
  entrar: (email: string, password: string) => Promise<void>;
  salir: () => void;
}
const C = createContext<Ctx>(null!);
export const useSesion = () => useContext(C);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [comprobando, setComprobando] = useState(!!sesion.token());

  const salir = useCallback(() => { sesion.borrar(); setUsuario(null); }, []);

  useEffect(() => {
    onSesionCaducada(salir);
    if (!sesion.token()) return;
    api.get<Usuario>('/auth/me').then(setUsuario).catch(() => sesion.borrar()).finally(() => setComprobando(false));
  }, [salir]);

  const entrar = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ token: string; usuario: Usuario }>('/auth/login', { email, password });
    sesion.guardar(r.token);
    // /me añade el nombre de la empresa; si fallara, basta con los datos del login.
    setUsuario(await api.get<Usuario>('/auth/me').catch(() => r.usuario));
  }, []);

  return <C.Provider value={{ usuario, comprobando, entrar, salir }}>{children}</C.Provider>;
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
