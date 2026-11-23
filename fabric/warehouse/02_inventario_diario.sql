-- Hecho de FOTO PERIÓDICA: stock y valor al cierre de cada día por producto y almacén.
-- Granularidad: una fila por producto, almacén y día. Es semiaditivo: se suma entre productos y almacenes,
-- pero NO entre fechas (en DAX se toma el último día del periodo).
-- Se materializa en el Warehouse porque se deriva del libro de movimientos con una suma acumulada.

CREATE OR ALTER PROCEDURE analitica.sp_cargar_inventario_diario
AS
BEGIN
    DROP TABLE IF EXISTS analitica.inventario_diario;

    CREATE TABLE analitica.inventario_diario AS
    WITH neto AS (            -- variación neta del día
        SELECT producto_key, almacen_key, fecha_key,
               SUM(cantidad)         AS variacion,
               SUM(cantidad_salida)  AS salidas
        FROM lh_businessflow.gold.fact_movimientos_inventario
        GROUP BY producto_key, almacen_key, fecha_key
    ),
    limites AS (SELECT MIN(fecha_key) AS desde, MAX(fecha_key) AS hasta FROM neto),
    malla AS (                -- todos los días para cada producto/almacén con actividad, haya o no movimiento
        SELECT pa.producto_key, pa.almacen_key, f.fecha_key
        FROM (SELECT DISTINCT producto_key, almacen_key FROM neto) pa
        CROSS JOIN lh_businessflow.gold.dim_fecha f
        CROSS JOIN limites l
        WHERE f.fecha_key BETWEEN l.desde AND l.hasta
    ),
    acumulado AS (
        SELECT m.producto_key, m.almacen_key, m.fecha_key,
               ISNULL(n.salidas, 0) AS salidas_dia,
               SUM(ISNULL(n.variacion, 0)) OVER (PARTITION BY m.producto_key, m.almacen_key
                                                 ORDER BY m.fecha_key ROWS UNBOUNDED PRECEDING) AS stock
        FROM malla m
        LEFT JOIN neto n ON n.producto_key = m.producto_key AND n.almacen_key = m.almacen_key AND n.fecha_key = m.fecha_key
    )
    SELECT a.producto_key, a.almacen_key, a.fecha_key,
           CAST(a.stock AS DECIMAL(14, 3))                          AS stock,
           CAST(a.stock * p.coste_estandar AS DECIMAL(18, 4))       AS valor_stock,
           CAST(a.salidas_dia AS DECIMAL(14, 3))                    AS salidas_dia,
           CAST(CASE WHEN a.stock <= 0 THEN 1 ELSE 0 END AS INT)    AS sin_stock
    FROM acumulado a
    JOIN lh_businessflow.gold.dim_producto p ON p.producto_key = a.producto_key;
END;
GO

EXEC analitica.sp_cargar_inventario_diario;
GO

-- Situación actual: última foto por producto (todos los almacenes) frente a su mínimo.
CREATE OR ALTER VIEW analitica.vw_stock_actual AS
WITH ultima AS (SELECT MAX(fecha_key) AS fecha_key FROM analitica.inventario_diario),
stock AS (
    SELECT i.producto_key, SUM(i.stock) AS stock, SUM(i.valor_stock) AS valor_stock
    FROM analitica.inventario_diario i JOIN ultima u ON u.fecha_key = i.fecha_key
    GROUP BY i.producto_key
)
SELECT p.sku, p.nombre, p.categoria, p.proveedor_preferente, s.stock, p.stock_minimo, s.valor_stock,
       CASE WHEN s.stock <= 0 THEN 'sin_stock' WHEN s.stock < p.stock_minimo THEN 'bajo_minimo' ELSE 'ok' END AS situacion,
       CAST(s.stock * 100.0 / NULLIF(p.stock_minimo, 0) AS DECIMAL(9, 1)) AS pct_sobre_minimo
FROM stock s
JOIN lh_businessflow.gold.dim_producto p ON p.producto_key = s.producto_key;
GO
