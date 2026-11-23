// Comprobación rápida de la capa analítica contra la base sembrada: npx tsx scripts/smoke.ts
import { pool } from '../src/db/pool.js';
import { costes, dashboard, reposicion } from '../src/services/analitica.js';

const d = await dashboard(1, {});
console.log('KPIs', d.kpis);
console.log('Gasto mensual', d.gasto_mensual.map((m: any) => `${m.mes}:${Math.round(m.gasto)}`).join(' '));
console.log('Proveedores', d.top_proveedores.map((p: any) => `${p.codigo} otd=${p.otd?.toFixed(2)} ret=${p.retraso_medio?.toFixed(1)} rech=${p.tasa_rechazo?.toFixed(3)} pts=${p.puntuacion}`));
const r = await reposicion(1);
const cuenta: Record<string, number> = {};
for (const f of r.filas) cuenta[f.urgencia] = (cuenta[f.urgencia] ?? 0) + 1;
console.log('Reposición', cuenta, r.filas.slice(0, 3).map((f: any) => `${f.sku} stock=${f.stock} camino=${f.en_camino} d=${f.consumo_medio_diario.toFixed(1)} L=${f.plazo_dias.toFixed(1)} Q=${f.cantidad_sugerida}`));
console.log('Costes', (await costes(1)).slice(0, 3).map((c: any) => `${c.sku} ${Math.round(c.gasto_12m)} var=${c.variacion_precio?.toFixed(3)}`));
await pool.end();
