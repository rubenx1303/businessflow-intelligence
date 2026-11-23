import { AlertTriangle, RotateCw } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { Boton } from './ui';

/** Si una pantalla falla al pintarse, se muestra el error en su hueco en lugar de dejar la aplicación en blanco. */
export class LimiteErrores extends Component<{ clave: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(previo: { clave: string }) { if (previo.clave !== this.props.clave && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-center px-6 py-16 text-center">
        <AlertTriangle size={28} className="mb-3 text-rojo" aria-hidden />
        <p className="font-medium">Esta pantalla no se ha podido mostrar</p>
        <p className="mt-1 max-w-[60ch] text-tenue">{this.state.error.message}</p>
        <Boton className="mt-4" onClick={() => this.setState({ error: null })}><RotateCw size={15} />Reintentar</Boton>
      </div>
    );
  }
}
