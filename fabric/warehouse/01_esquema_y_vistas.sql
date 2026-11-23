-- Warehouse wh_businessflow · capa de consumo en T-SQL.
-- Las tablas Gold viven como Delta en el Lakehouse; aquí se consultan con nombres de tres partes
-- (consulta entre bases de datos dentro de la misma área de trabajo), sin copiar datos.

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'analitica')
    EXEC('CREATE SCHEMA analitica');
GO

-- Evolución mensual del gasto: variación frente al mes anterior y acumulado del año (funciones de ventana).
CREATE OR ALTER VIEW analitica.vw_gasto_mensual AS
WITH mensual AS (
    SELECT f.anio, f.mes, f.anio_mes,
           SUM(c.importe)              AS gasto,
           COUNT(DISTINCT c.pedido_id) AS pedidos
    FROM lh_businessflow.gold.fact_compras c
    JOIN lh_businessflow.gold.dim_fecha f ON f.fecha_key = c.fecha_pedido_key
    WHERE c.estado_pedido NOT IN ('borrador', 'cancelado')
    GROUP BY f.anio, f.mes, f.anio_mes
)
SELECT anio, mes, anio_mes, gasto, pedidos,
       LAG(gasto) OVER (ORDER BY anio, mes)                                         AS gasto_mes_anterior,
       CAST((gasto - LAG(gasto) OVER (ORDER BY anio, mes)) * 100.0
            / NULLIF(LAG(gasto) OVER (ORDER BY anio, mes), 0) AS DECIMAL(9, 2))     AS variacion_pct,
       SUM(gasto) OVER (PARTITION BY anio ORDER BY mes ROWS UNBOUNDED PRECEDING)    AS gasto_acumulado_anio,
       CAST(AVG(gasto) OVER (ORDER BY anio, mes ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS DECIMAL(18, 2)) AS media_movil_3m
FROM mensual;
GO

-- Rendimiento por proveedor. La puntualidad se mide por PEDIDO, no por línea: primero se reduce el hecho a un pedido por fila.
CREATE OR ALTER VIEW analitica.vw_rendimiento_proveedor AS
WITH pedidos AS (
    SELECT pedido_id, proveedor_key,
           MAX(CAST(pedido_completo AS INT)) AS completo,
           MAX(CAST(pedido_a_tiempo AS INT)) AS a_tiempo,
           MAX(dias_retraso)                 AS dias_retraso,
           MAX(plazo_real_dias)              AS plazo_real_dias,
           SUM(importe)                      AS importe,
           SUM(cantidad_recibida)            AS recibida,
           SUM(cantidad_rechazada)           AS rechazada
    FROM lh_businessflow.gold.fact_compras
    WHERE estado_pedido NOT IN ('borrador', 'cancelado')
    GROUP BY pedido_id, proveedor_key
),
agregado AS (
    SELECT proveedor_key,
           COUNT(*)                                                         AS pedidos,
           SUM(completo)                                                    AS pedidos_completados,
           SUM(importe)                                                     AS gasto,
           CAST(AVG(CASE WHEN completo = 1 THEN a_tiempo * 100.0 END) AS DECIMAL(5, 2))      AS pct_entregas_puntuales,
           CAST(AVG(CASE WHEN completo = 1 THEN dias_retraso * 1.0 END) AS DECIMAL(6, 2))    AS retraso_medio_dias,
           CAST(AVG(CASE WHEN completo = 1 THEN plazo_real_dias * 1.0 END) AS DECIMAL(6, 2)) AS plazo_real_dias,
           CAST(SUM(rechazada) * 100.0 / NULLIF(SUM(recibida) + SUM(rechazada), 0) AS DECIMAL(6, 3)) AS pct_rechazo
    FROM pedidos
    GROUP BY proveedor_key
)
SELECT p.proveedor_key, p.codigo, p.nombre, p.estado, p.plazo_acordado_dias,
       a.pedidos, a.pedidos_completados, a.gasto,
       CAST(a.gasto * 100.0 / SUM(a.gasto) OVER () AS DECIMAL(5, 2))  AS cuota_gasto_pct,
       DENSE_RANK() OVER (ORDER BY a.gasto DESC)                      AS ranking_gasto,
       a.pct_entregas_puntuales, a.retraso_medio_dias, a.plazo_real_dias,
       CAST(a.plazo_real_dias - p.plazo_acordado_dias AS DECIMAL(6, 2)) AS desviacion_plazo_dias,
       a.pct_rechazo,
       DENSE_RANK() OVER (ORDER BY a.pct_entregas_puntuales DESC)     AS ranking_puntualidad
FROM agregado a
JOIN lh_businessflow.gold.dim_proveedor p ON p.proveedor_key = a.proveedor_key;
GO

-- Puntualidad por proveedor y trimestre, con el cambio respecto al trimestre anterior: detecta deterioros.
CREATE OR ALTER VIEW analitica.vw_puntualidad_trimestral AS
WITH pedidos AS (
    SELECT c.pedido_id, c.proveedor_key, f.anio, f.trimestre,
           MAX(CAST(c.pedido_a_tiempo AS INT)) AS a_tiempo,
           MAX(c.dias_retraso)                 AS dias_retraso
    FROM lh_businessflow.gold.fact_compras c
    JOIN lh_businessflow.gold.dim_fecha f ON f.fecha_key = c.fecha_pedido_key
    WHERE c.pedido_completo = 1
    GROUP BY c.pedido_id, c.proveedor_key, f.anio, f.trimestre
),
trimestral AS (
    SELECT proveedor_key, anio, trimestre, COUNT(*) AS pedidos,
           CAST(AVG(a_tiempo * 100.0) AS DECIMAL(5, 2))     AS pct_puntual,
           CAST(AVG(dias_retraso * 1.0) AS DECIMAL(6, 2))   AS retraso_medio_dias
    FROM pedidos
    GROUP BY proveedor_key, anio, trimestre
)
SELECT p.codigo, p.nombre, t.anio, t.trimestre, t.pedidos, t.pct_puntual, t.retraso_medio_dias,
       LAG(t.pct_puntual) OVER (PARTITION BY t.proveedor_key ORDER BY t.anio, t.trimestre) AS pct_puntual_trim_anterior,
       CAST(t.pct_puntual - LAG(t.pct_puntual) OVER (PARTITION BY t.proveedor_key ORDER BY t.anio, t.trimestre) AS DECIMAL(6, 2)) AS variacion_puntos
FROM trimestral t
JOIN lh_businessflow.gold.dim_proveedor p ON p.proveedor_key = t.proveedor_key;
GO
