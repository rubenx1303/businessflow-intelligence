import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ProveedorAvisos } from './components/ui';
import './index.css';
import { ProveedorSesion } from './lib/auth';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ProveedorSesion>
        <ProveedorAvisos>
          <App />
        </ProveedorAvisos>
      </ProveedorSesion>
    </BrowserRouter>
  </StrictMode>,
);
