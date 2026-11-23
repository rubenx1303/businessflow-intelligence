import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Filtros guardados en la URL: se pueden compartir, recargar y volver atrás sin perderlos. */
export function useFiltrosUrl<K extends string>(claves: readonly K[]) {
  const [sp, setSp] = useSearchParams();
  const texto = sp.toString();
  const f = useMemo(() => Object.fromEntries(claves.map((k) => [k, sp.get(k) ?? ''])) as Record<K, string>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [texto]);
  const cambiar = useCallback((c: Partial<Record<K, string>>) => {
    setSp((previo) => {
      const n = new URLSearchParams(previo);
      for (const [k, v] of Object.entries(c)) { if (v) n.set(k, v as string); else n.delete(k); }
      return n;
    }, { replace: true });
  }, [setSp]);
  const limpiar = useCallback(() => {
    setSp((previo) => { const n = new URLSearchParams(previo); for (const k of claves) n.delete(k); return n; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSp]);
  return { f, cambiar, limpiar, activos: claves.some((k) => !!f[k]) };
}
