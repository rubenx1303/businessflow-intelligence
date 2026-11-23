import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Esqueleto, Vacio } from './components/ui';
import { puede } from './lib/api';
import { useSesion } from './lib/auth';
import { Login } from './pages/Login';

// Cada pantalla se carga cuando se visita: el arranque no descarga los gráficos ni las páginas que no se abren.
const pagina = <T extends Record<string, any>>(carga: () => Promise<T>, nombre: keyof T) => lazy(() => carga().then((m) => ({ default: m[nombre] })));
const Dashboard = pagina(() => import('./pages/Dashboard'), 'Dashboard');
const Proveedores = pagina(() => import('./pages/Proveedores'), 'Proveedores');
const Inventario = pagina(() => import('./pages/Inventario'), 'Inventario');
const Compras = pagina(() => import('./pages/Compras'), 'Compras');
const PedidoDetalle = pagina(() => import('./pages/PedidoDetalle'), 'PedidoDetalle');
const Inteligencia = pagina(() => import('./pages/Inteligencia'), 'Inteligencia');
const Informes = pagina(() => import('./pages/Informes'), 'Informes');
const Datos = pagina(() => import('./pages/Datos'), 'Datos');
const Auditoria = pagina(() => import('./pages/Auditoria'), 'Auditoria');

const Cargando = () => (
  <div className="space-y-4" role="status" aria-label="Cargando pantalla"><Esqueleto className="h-8 w-64" /><Esqueleto className="h-24 w-full" /><Esqueleto className="h-64 w-full" /></div>
);
const s = (el: React.ReactNode) => <Suspense fallback={<Cargando />}>{el}</Suspense>;

export function App() {
  const { usuario, comprobando } = useSesion();
  if (comprobando) {
    return <div className="grid min-h-dvh place-items-center" role="status" aria-label="Comprobando sesión"><Esqueleto className="h-2 w-40" /></div>;
  }
  if (!usuario) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={s(<Dashboard />)} />
        <Route path="proveedores" element={s(<Proveedores />)} />
        <Route path="inventario" element={s(<Inventario />)} />
        <Route path="compras" element={s(<Compras />)} />
        <Route path="compras/:id" element={s(<PedidoDetalle />)} />
        <Route path="inteligencia" element={s(<Inteligencia />)} />
        <Route path="informes" element={s(<Informes />)} />
        <Route path="datos" element={s(<Datos />)} />
        <Route path="auditoria" element={puede(usuario.rol, 'auditoria') ? s(<Auditoria />) : <Vacio titulo="Sin acceso" texto="El registro de auditoría solo está disponible para administración." />} />
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Vacio titulo="Página no encontrada" texto="La dirección no corresponde a ninguna pantalla de la aplicación." />} />
      </Route>
    </Routes>
  );
}
