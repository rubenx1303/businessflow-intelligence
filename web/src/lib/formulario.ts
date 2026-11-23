import { useCallback, useState } from 'react';
import { ErrorApi } from './api';

/** Estado de formulario con envío asíncrono y errores de campo devueltos por el servidor. */
export function useFormulario<T extends Record<string, any>>(inicial: T) {
  const [v, setV] = useState<T>(inicial);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const poner = useCallback(<K extends keyof T>(k: K, valor: T[K]) => {
    setV((x) => ({ ...x, [k]: valor }));
    setErrores((e) => { if (!(k as string in e)) return e; const { [k as string]: _, ...resto } = e; return resto; });
  }, []);

  /** Ejecuta la acción; devuelve true si terminó bien. Los errores quedan en `errores` / `general`. */
  const enviar = useCallback(async (accion: () => Promise<void>, validar?: () => Record<string, string>) => {
    const locales = validar?.() ?? {};
    if (Object.keys(locales).length) { setErrores(locales); setGeneral('Revisa los campos marcados.'); return false; }
    setErrores({}); setGeneral(null); setEnviando(true);
    try { await accion(); return true; }
    catch (e) {
      if (e instanceof ErrorApi) {
        const campos = e.porCampo();
        setErrores(campos);
        // Si el servidor señala campos que el formulario no muestra, se enseñan en el aviso general.
        setGeneral(e.campos.length ? `${e.message}: ${e.campos.map((c) => c.mensaje).join('; ')}` : e.message);
      } else setGeneral(String((e as Error)?.message ?? e));
      return false;
    } finally { setEnviando(false); }
  }, []);

  return { v, setV, poner, errores, general, enviando, enviar };
}
