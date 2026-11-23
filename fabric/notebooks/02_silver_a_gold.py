# %% [markdown]
# # 02 · Silver → Gold (modelo dimensional)
# Construye un **esquema en estrella** en el esquema `gold` del Lakehouse.
#
# | Tabla | Granularidad (una fila por…) |
# |---|---|
# | `dim_fecha` | día natural |
# | `dim_producto` | producto (SCD tipo 1: se sobrescribe con el último valor) |
# | `dim_proveedor` | proveedor (SCD tipo 1) |
# | `dim_almacen` | almacén |
# | `fact_compras` | **línea de pedido de compra** |
# | `fact_recepciones` | **línea de recepción** (un albarán puede tener varias; un pedido, varias recepciones) |
# | `fact_movimientos_inventario` | **movimiento de stock** (entrada, salida o ajuste de un producto en un almacén) |
#
# Las claves de dimensión son las claves del sistema origen (enteras y estables): con SCD1 no hace falta
# clave subrogada. Las claves de fecha son enteros `yyyyMMdd`.

# %%
import json
import uuid
from datetime import datetime, timezone

from pyspark.sql import functions as F

# Marcadores: desplegar_notebook.py los sustituye por FABRIC_WORKSPACE_ID y FABRIC_LAKEHOUSE_ID de .env.
WORKSPACE_ID = "<WORKSPACE_ID>"
LAKEHOUSE_ID = "<LAKEHOUSE_ID>"
BASE = f"abfss://{WORKSPACE_ID}@onelake.dfs.fabric.microsoft.com/{LAKEHOUSE_ID}"
SILVER, GOLD = f"{BASE}/Tables/silver", f"{BASE}/Tables/gold"

ID_EJECUCION = uuid.uuid4().hex[:12]
INICIO = datetime.now(timezone.utc)
spark.conf.set("spark.sql.shuffle.partitions", "8")

for t in ["proveedores", "productos", "almacenes", "pedidos_compra", "lineas_pedido", "recepciones", "lineas_recepcion", "movimientos_stock"]:
    spark.read.format("delta").load(f"{SILVER}/{t}").createOrReplaceTempView(f"s_{t}")

resultados = []

def guardar(nombre: str, df, clave: str):
    """Escribe la tabla Gold y comprueba que la clave declarada es única (la granularidad se cumple)."""
    df.write.format("delta").mode("overwrite").option("overwriteSchema", "true").save(f"{GOLD}/{nombre}")
    escrito = spark.read.format("delta").load(f"{GOLD}/{nombre}")
    escrito.createOrReplaceTempView(f"g_{nombre}")
    filas, claves = escrito.count(), escrito.select(clave).distinct().count()
    assert filas == claves, f"{nombre}: {filas} filas pero {claves} claves distintas → granularidad rota"
    resultados.append({"id_ejecucion": ID_EJECUCION, "tabla": nombre, "filas": filas})
    print(f"{nombre}: {filas} filas")

# %% [markdown]
# ## Dimensiones

# %%
limites = spark.sql("""
    SELECT least(min(fecha_pedido), (SELECT min(fecha_dia) FROM s_movimientos_stock)) AS desde,
           greatest(max(fecha_entrega_prevista), current_date()) AS hasta
    FROM s_pedidos_compra""").first()

guardar("dim_fecha", spark.sql(f"""
    SELECT CAST(date_format(d, 'yyyyMMdd') AS INT)  AS fecha_key,
           d                                        AS fecha,
           year(d)                                  AS anio,
           quarter(d)                               AS trimestre,
           month(d)                                 AS mes,
           element_at(array('enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'), month(d)) AS nombre_mes,
           date_format(d, 'yyyy-MM')                AS anio_mes,
           year(d) * 100 + month(d)                 AS anio_mes_orden,
           weekofyear(d)                            AS semana_iso,
           weekday(d) + 1                           AS dia_semana,
           element_at(array('lunes','martes','miércoles','jueves','viernes','sábado','domingo'), weekday(d) + 1) AS nombre_dia,
           weekday(d) >= 5                          AS es_fin_de_semana
    FROM (SELECT explode(sequence(trunc(DATE'{limites.desde}', 'year'), last_day(add_months(trunc(DATE'{limites.hasta}', 'year'), 11)), interval 1 day)) AS d)
"""), "fecha_key")

guardar("dim_proveedor", spark.sql("""
    SELECT id AS proveedor_key, codigo, nombre, cif, ciudad, pais, estado,
           plazo_entrega_dias AS plazo_acordado_dias, condiciones_pago
    FROM s_proveedores"""), "proveedor_key")

guardar("dim_almacen", spark.sql("SELECT id AS almacen_key, codigo, nombre, ciudad, activo FROM s_almacenes"), "almacen_key")

guardar("dim_producto", spark.sql("""
    SELECT p.id AS producto_key, p.sku, p.nombre, p.categoria, p.unidad,
           CAST(p.coste_estandar AS DECIMAL(12,4)) AS coste_estandar,
           CAST(p.stock_minimo  AS DECIMAL(14,3)) AS stock_minimo,
           CAST(p.lote_compra   AS DECIMAL(14,3)) AS lote_compra,
           p.proveedor_preferente_id AS proveedor_preferente_key, pr.nombre AS proveedor_preferente, p.activo
    FROM s_productos p LEFT JOIN s_proveedores pr ON pr.id = p.proveedor_preferente_id"""), "producto_key")

# %% [markdown]
# ## Hechos
# ### fact_compras — una fila por línea de pedido
# Lleva las cantidades recibida, rechazada y pendiente acumuladas de la línea, y los indicadores de
# entrega del **pedido** (fecha de última recepción, completo, a tiempo) para poder calcular la puntualidad
# con `DISTINCTCOUNT(pedido_id)` sin duplicar pedidos de varias líneas.

# %%
guardar("fact_compras", spark.sql("""
    WITH rec_linea AS (
        SELECT lr.linea_pedido_id, sum(lr.cantidad_recibida) AS recibida, sum(lr.cantidad_rechazada) AS rechazada,
               max(r.fecha_recepcion) AS ultima_recepcion
        FROM s_lineas_recepcion lr JOIN s_recepciones r ON r.id = lr.recepcion_id
        GROUP BY lr.linea_pedido_id),
    rec_pedido AS (SELECT pedido_id, max(fecha_recepcion) AS ultima_recepcion FROM s_recepciones GROUP BY pedido_id)
    SELECT lp.id                                              AS linea_pedido_id,
           pc.id                                              AS pedido_id,
           pc.numero                                          AS numero_pedido,
           CAST(date_format(pc.fecha_pedido, 'yyyyMMdd') AS INT)            AS fecha_pedido_key,
           CAST(date_format(pc.fecha_entrega_prevista, 'yyyyMMdd') AS INT)  AS fecha_entrega_prevista_key,
           lp.producto_id                                     AS producto_key,
           pc.proveedor_id                                    AS proveedor_key,
           pc.almacen_id                                      AS almacen_key,
           pc.estado                                          AS estado_pedido,
           CAST(lp.cantidad AS DECIMAL(14,3))                 AS cantidad_pedida,
           CAST(lp.precio_unitario AS DECIMAL(12,4))          AS precio_unitario,
           CAST(lp.cantidad * lp.precio_unitario AS DECIMAL(18,4))          AS importe,
           CAST(coalesce(rl.recibida, 0)  AS DECIMAL(14,3))   AS cantidad_recibida,
           CAST(coalesce(rl.rechazada, 0) AS DECIMAL(14,3))   AS cantidad_rechazada,
           CAST(greatest(lp.cantidad - coalesce(rl.recibida, 0), 0) AS DECIMAL(14,3)) AS cantidad_pendiente,
           CAST(date_format(rp.ultima_recepcion, 'yyyyMMdd') AS INT)        AS fecha_ultima_recepcion_pedido_key,
           pc.estado = 'recibido'                             AS pedido_completo,
           CASE WHEN pc.estado = 'recibido' THEN rp.ultima_recepcion <= pc.fecha_entrega_prevista END AS pedido_a_tiempo,
           CASE WHEN pc.estado = 'recibido' THEN greatest(datediff(rp.ultima_recepcion, pc.fecha_entrega_prevista), 0) END AS dias_retraso,
           CASE WHEN pc.estado = 'recibido' THEN datediff(rp.ultima_recepcion, pc.fecha_pedido) END AS plazo_real_dias
    FROM s_lineas_pedido lp
    JOIN s_pedidos_compra pc ON pc.id = lp.pedido_id
    LEFT JOIN rec_linea rl ON rl.linea_pedido_id = lp.id
    LEFT JOIN rec_pedido rp ON rp.pedido_id = pc.id
"""), "linea_pedido_id")

# %% [markdown]
# ### fact_recepciones — una fila por línea de recepción

# %%
guardar("fact_recepciones", spark.sql("""
    SELECT lr.id                                              AS linea_recepcion_id,
           r.id                                               AS recepcion_id,
           r.albaran,
           pc.id                                              AS pedido_id,
           lr.linea_pedido_id,
           CAST(date_format(r.fecha_recepcion, 'yyyyMMdd') AS INT) AS fecha_recepcion_key,
           lp.producto_id                                     AS producto_key,
           pc.proveedor_id                                    AS proveedor_key,
           pc.almacen_id                                      AS almacen_key,
           CAST(lr.cantidad_recibida  AS DECIMAL(14,3))       AS cantidad_recibida,
           CAST(lr.cantidad_rechazada AS DECIMAL(14,3))       AS cantidad_rechazada,
           CAST(lr.cantidad_recibida * lp.precio_unitario AS DECIMAL(18,4)) AS importe_recibido,
           datediff(r.fecha_recepcion, pc.fecha_pedido)             AS dias_desde_pedido,
           datediff(r.fecha_recepcion, pc.fecha_entrega_prevista)   AS dias_respecto_previsto
    FROM s_lineas_recepcion lr
    JOIN s_recepciones r     ON r.id = lr.recepcion_id
    JOIN s_lineas_pedido lp  ON lp.id = lr.linea_pedido_id
    JOIN s_pedidos_compra pc ON pc.id = r.pedido_id
"""), "linea_recepcion_id")

# %% [markdown]
# ### fact_movimientos_inventario — una fila por movimiento
# `cantidad` conserva el signo (el stock a una fecha es la suma acumulada). `importe` valora el movimiento
# al coste con el que se registró: precio de compra en las entradas, coste estándar en salidas y ajustes.

# %%
guardar("fact_movimientos_inventario", spark.sql("""
    SELECT m.id                                               AS movimiento_id,
           CAST(date_format(m.fecha_dia, 'yyyyMMdd') AS INT)  AS fecha_key,
           m.producto_id                                      AS producto_key,
           m.almacen_id                                       AS almacen_key,
           m.tipo                                             AS tipo_movimiento,
           m.recepcion_id,
           CAST(m.cantidad AS DECIMAL(14,3))                  AS cantidad,
           CAST(m.coste_unitario AS DECIMAL(12,4))            AS coste_unitario,
           CAST(m.cantidad * m.coste_unitario AS DECIMAL(18,4))             AS importe,
           CAST(CASE WHEN m.cantidad > 0 THEN m.cantidad ELSE 0 END AS DECIMAL(14,3))  AS cantidad_entrada,
           CAST(CASE WHEN m.cantidad < 0 THEN -m.cantidad ELSE 0 END AS DECIMAL(14,3)) AS cantidad_salida
    FROM s_movimientos_stock m
"""), "movimiento_id")

# %% [markdown]
# ## Controles de integridad del modelo
# Ninguna clave foránea de un hecho puede quedar huérfana, y los totales deben cuadrar con Silver.

# %%
controles = {}
relaciones = [
    ("fact_compras", "producto_key", "dim_producto"), ("fact_compras", "proveedor_key", "dim_proveedor"),
    ("fact_compras", "almacen_key", "dim_almacen"), ("fact_compras", "fecha_pedido_key", "dim_fecha"),
    ("fact_recepciones", "producto_key", "dim_producto"), ("fact_recepciones", "proveedor_key", "dim_proveedor"),
    ("fact_recepciones", "fecha_recepcion_key", "dim_fecha"),
    ("fact_movimientos_inventario", "producto_key", "dim_producto"), ("fact_movimientos_inventario", "almacen_key", "dim_almacen"),
    ("fact_movimientos_inventario", "fecha_key", "dim_fecha"),
]
for hecho, col, dim in relaciones:
    clave_dim = "fecha_key" if dim == "dim_fecha" else col
    huerfanas = spark.sql(f"SELECT count(*) FROM g_{hecho} h LEFT ANTI JOIN g_{dim} d ON h.{col} = d.{clave_dim}").first()[0]
    controles[f"huerfanas_{hecho}.{col}"] = huerfanas
    assert huerfanas == 0, f"{hecho}.{col}: {huerfanas} filas sin correspondencia en {dim}"

cuadre = spark.sql("""
    SELECT (SELECT CAST(sum(importe) AS DECIMAL(18,4)) FROM g_fact_compras)                         AS gold_importe,
           (SELECT CAST(sum(cantidad * precio_unitario) AS DECIMAL(18,4)) FROM s_lineas_pedido)     AS silver_importe,
           (SELECT sum(cantidad) FROM g_fact_movimientos_inventario)                                AS gold_stock,
           (SELECT sum(cantidad) FROM s_movimientos_stock)                                          AS silver_stock,
           (SELECT sum(cantidad_recibida) FROM g_fact_recepciones)                                  AS gold_recibido,
           (SELECT sum(cantidad_recibida) FROM g_fact_compras)                                      AS gold_recibido_en_compras""").first()
assert cuadre.gold_importe == cuadre.silver_importe, "El importe de compras no cuadra con Silver"
assert cuadre.gold_stock == cuadre.silver_stock, "El stock total no cuadra con Silver"
assert cuadre.gold_recibido == cuadre.gold_recibido_en_compras, "Lo recibido difiere entre fact_recepciones y fact_compras"
controles.update({k: str(v) for k, v in cuadre.asDict().items()})

log = (spark.createDataFrame(resultados)
       .withColumn("ejecutado_en", F.lit(INICIO.isoformat()).cast("timestamp"))
       .withColumn("controles", F.lit(json.dumps(controles))))
log.write.format("delta").mode("append").save(f"{GOLD}/control_cargas")
display(log.select("tabla", "filas"))
print(json.dumps(controles, indent=1))
