import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Esqueleto, Vacio } from './components/ui';
import { puede } from './lib/api';
import { useSesion } from './lib/auth';
import { Auditoria } from './pages/Auditoria';
import { Compras } from './pages/Compras';
import { Dashboard } from './pages/Dashboard';
import { Inteligencia } from './pages/Inteligencia';
import { Inventario } from './pages/Inventario';
import { Login } from './pages/Login';
import { PedidoDetalle } from './pages/PedidoDetalle';
import { Proveedores } from './pages/Proveedores';

export function App() {
  const { usuario, comprobando } = useSesion();
  if (comprobando) {
    return <div className="grid min-h-dvh place-items-center" role="status" aria-label="Comprobando sesión"><Esqueleto className="h-2 w-40" /></div>;
  }
  if (!usuario) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="proveedores" element={<Proveedores />} />
        <Route path="inventario" element={<Inventario />} />
        <Route path="compras" element={<Compras />} />
        <Route path="compras/:id" element={<PedidoDetalle />} />
        <Route path="inteligencia" element={<Inteligencia />} />
        <Route path="auditoria" element={puede(usuario.rol, 'auditoria') ? <Auditoria /> : <Vacio titulo="Sin acceso" texto="El registro de auditoría solo está disponible para administración." />} />
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Vacio titulo="Página no encontrada" texto="La dirección no corresponde a ninguna pantalla de la aplicación." />} />
      </Route>
    </Routes>
  );
}
