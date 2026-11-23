import { Boxes, ChevronsLeft, ChevronsRight, ClipboardList, Database, FileBarChart, LayoutDashboard, LineChart, LogOut, Menu, Moon, ScrollText, Sun, Truck, X } from 'lucide-react';
import { LimiteErrores } from './LimiteErrores';
import { RestaurarDemo } from './Operaciones';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { puede } from '../lib/api';
import { useSesion, useTema } from '../lib/auth';
import { ETIQUETA_ROL } from '../lib/format';
import { Boton, cx } from './ui';

const NAV = [
  { a: '/', etiqueta: 'Panel', icono: LayoutDashboard, fin: true },
  { a: '/proveedores', etiqueta: 'Proveedores', icono: Truck },
  { a: '/inventario', etiqueta: 'Inventario', icono: Boxes },
  { a: '/compras', etiqueta: 'Compras', icono: ClipboardList },
  { a: '/inteligencia', etiqueta: 'Inteligencia', icono: LineChart },
  { a: '/informes', etiqueta: 'Informes', icono: FileBarChart },
  { a: '/datos', etiqueta: 'Datos', icono: Database },
  { a: '/auditoria', etiqueta: 'Auditoría', icono: ScrollText, permiso: 'auditoria' },
];

function Marca({ compacta }: { compacta?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 overflow-hidden">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-marca text-[13px] font-bold tracking-tight text-sobre-marca" aria-hidden>BF</span>
      {!compacta && <span className="titulo truncate text-[15px] leading-tight">BusinessFlow<br /><span className="font-normal text-tenue">Intelligence</span></span>}
    </div>
  );
}

export function Layout() {
  const { usuario, salir, demo } = useSesion();
  const { oscuro, alternar } = useTema();
  const [plegada, setPlegada] = useState(() => { try { return localStorage.getItem('bfi-nav') === 'plegada'; } catch { return false; } });
  const [cajon, setCajon] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setCajon(false), [pathname]);
  useEffect(() => { try { localStorage.setItem('bfi-nav', plegada ? 'plegada' : 'abierta'); } catch { /* sin almacenamiento */ } }, [plegada]);

  const enlaces = (compacta: boolean) => (
    <nav aria-label="Principal" className="flex flex-1 flex-col gap-0.5 px-2 py-3">
      {NAV.filter((n) => !n.permiso || puede(usuario?.rol, n.permiso)).map((n) => (
        <NavLink key={n.a} to={n.a} end={n.fin} title={compacta ? n.etiqueta : undefined}
          className={({ isActive }) => cx('flex h-9 items-center gap-3 rounded-md px-2.5 font-medium transition-colors',
            isActive ? 'bg-marca-suave text-marca' : 'text-tenue hover:bg-panel2 hover:text-tinta', compacta && 'justify-center px-0')}>
          <n.icono size={18} className="shrink-0" aria-hidden />
          {compacta ? <span className="sr-only">{n.etiqueta}</span> : n.etiqueta}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[70] focus:rounded-md focus:bg-marca focus:px-3 focus:py-2 focus:text-sobre-marca">Saltar al contenido</a>

      {/* Lateral fija (escritorio) */}
      <aside className={cx('sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-linea bg-panel transition-[width] duration-200 lg:flex', plegada ? 'w-[60px]' : 'w-[216px]')}>
        <div className={cx('flex h-14 items-center border-b border-linea', plegada ? 'justify-center' : 'px-3.5')}><Marca compacta={plegada} /></div>
        {enlaces(plegada)}
        <div className="space-y-0.5 border-t border-linea p-2">
          <RestaurarDemo compacto plegado={plegada} />
          <Boton variante="fantasma" className={cx('w-full', !plegada && 'justify-start')} onClick={() => setPlegada((p) => !p)} aria-expanded={!plegada}
            aria-label={plegada ? 'Desplegar navegación' : 'Plegar navegación'}>
            {plegada ? <ChevronsRight size={17} /> : <><ChevronsLeft size={17} />Plegar</>}
          </Boton>
        </div>
      </aside>

      {/* Cajón (móvil) */}
      {cajon && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="anim-fondo absolute inset-0 bg-black/45" onClick={() => setCajon(false)} aria-hidden />
          <aside className="anim-modal relative flex h-full w-64 max-w-[85vw] flex-col border-r border-linea bg-panel">
            <div className="flex h-14 items-center justify-between border-b border-linea px-3.5">
              <Marca />
              <Boton variante="fantasma" pequeno onClick={() => setCajon(false)} aria-label="Cerrar menú"><X size={18} /></Boton>
            </div>
            {enlaces(false)}
            <div className="border-t border-linea p-2"><RestaurarDemo compacto /></div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-linea bg-panel/90 px-3 backdrop-blur sm:px-5">
          <Boton variante="fantasma" className="lg:hidden" onClick={() => setCajon(true)} aria-label="Abrir menú"><Menu size={19} /></Boton>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <p className="truncate font-medium">{usuario?.empresa ?? 'BusinessFlow Intelligence'}</p>
            {demo && <span className="shrink-0 rounded-sm bg-ambar-suave px-1.5 py-px text-xs font-medium whitespace-nowrap text-ambar" title="Demostración local: la empresa y todas sus operaciones son ficticias">Demo<span className="hidden md:inline">, datos ficticios</span></span>}
          </div>
          <div className="hidden min-w-0 text-right leading-tight sm:block">
            <p className="truncate text-[13px] font-medium">{usuario?.nombre}</p>
            <p className="truncate text-xs text-tenue">{ETIQUETA_ROL[usuario?.rol ?? ''] ?? usuario?.rol}</p>
          </div>
          <Boton variante="fantasma" onClick={alternar} aria-label={oscuro ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'} aria-pressed={oscuro}>
            {oscuro ? <Sun size={18} /> : <Moon size={18} />}
          </Boton>
          <Boton variante="fantasma" onClick={salir} aria-label="Cerrar sesión" title="Cerrar sesión"><LogOut size={18} /></Boton>
        </header>
        <main id="contenido" className="mx-auto w-full max-w-[1480px] flex-1 px-3 py-5 sm:px-6 sm:py-6">
          <LimiteErrores clave={pathname}><Outlet /></LimiteErrores>
        </main>
      </div>
    </div>
  );
}
