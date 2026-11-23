import { describe, expect, it } from 'vitest';
import { calcularReposicion, puntuarProveedor } from '../src/services/reposicion.js';

const base = { stock: 100, enCamino: 0, consumoMedioDiario: 10, sigmaDiaria: 4, plazoDias: 4, loteCompra: 12, stockMinimo: 0 };

describe('calcularReposicion', () => {
  it('aplica SS = z·σ·√L y ROP = d·L + SS', () => {
    const r = calcularReposicion(base, { z: 1.65, diasCobertura: 30 });
    expect(r.stockSeguridad).toBeCloseTo(1.65 * 4 * 2, 2); // 13,2
    expect(r.puntoPedido).toBeCloseTo(10 * 4 + 13.2, 2);   // 53,2
    expect(r.diasCobertura).toBe(10);
  });

  it('no recomienda pedir si la posición supera el punto de pedido', () => {
    const r = calcularReposicion(base);
    expect(r.cantidadSugerida).toBe(0);
    expect(r.urgencia).toBe('ok');
  });

  it('pide hasta cubrir plazo + cobertura, redondeando al lote hacia arriba', () => {
    const r = calcularReposicion({ ...base, stock: 50 }, { z: 1.65, diasCobertura: 30 });
    // objetivo = 10·(4+30) + 13,2 = 353,2 ; falta 303,2 → 26 lotes de 12 = 312
    expect(r.cantidadSugerida).toBe(312);
    expect(r.cantidadSugerida % 12).toBe(0);
    expect(r.urgencia).toBe('alta');
  });

  it('descuenta lo que ya está en camino', () => {
    const sin = calcularReposicion({ ...base, stock: 20 });
    const con = calcularReposicion({ ...base, stock: 20, enCamino: 30 });
    expect(sin.cantidadSugerida - con.cantidadSugerida).toBeGreaterThanOrEqual(24);
    expect(calcularReposicion({ ...base, stock: 20, enCamino: 500 }).cantidadSugerida).toBe(0);
  });

  it('marca crítico cuando el stock no cubre el plazo y no viene nada', () => {
    expect(calcularReposicion({ ...base, stock: 30 }).urgencia).toBe('critica'); // 3 días de cobertura < 4 de plazo
    expect(calcularReposicion({ ...base, stock: 0 }).urgencia).toBe('critica');
  });

  it('el stock mínimo manual actúa de suelo del punto de pedido', () => {
    const r = calcularReposicion({ ...base, consumoMedioDiario: 0, sigmaDiaria: 0, stock: 5, stockMinimo: 20 });
    expect(r.puntoPedido).toBe(20);
    expect(r.cantidadSugerida).toBe(24); // faltan 15 → 2 lotes de 12
  });

  it('distingue producto sin consumo y bajo mínimo ya cubierto', () => {
    expect(calcularReposicion({ ...base, consumoMedioDiario: 0, sigmaDiaria: 0 }).urgencia).toBe('sin_consumo');
    expect(calcularReposicion({ ...base, stock: 60, enCamino: 200, stockMinimo: 80 }).urgencia).toBe('vigilar');
  });
});

describe('puntuarProveedor', () => {
  it('pondera puntualidad, calidad y retraso', () => {
    expect(puntuarProveedor({ otd: 1, tasaRechazo: 0, retrasoMedio: 0 })).toBe(100);
    expect(puntuarProveedor({ otd: 0.5, tasaRechazo: 0.05, retrasoMedio: 5 })).toBe(50); // 30 + 12,5 + 7,5
    expect(puntuarProveedor({ otd: null, tasaRechazo: null, retrasoMedio: null })).toBeNull();
  });
});
