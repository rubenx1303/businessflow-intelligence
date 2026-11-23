# %% [markdown]
# # 01 · Bronze → Silver
# Lee los Parquet originales de `Files/bronze` (todas las cargas), y por cada tabla:
# 1. **Deduplica**: se queda con la versión más reciente de cada clave (`_fecha_carga` más alta).
# 2. **Normaliza** textos, identificadores fiscales, correos y fechas.
# 3. **Valida** reglas de negocio y **referencias** entre tablas.
# 4. Escribe las filas válidas como tabla **Delta** en el esquema `silver` y manda las inválidas a cuarentena
#    (`silver.calidad_rechazos`) con el motivo.
# 5. Registra el resultado en `silver.calidad_ejecuciones` (leídas, duplicadas, rechazadas, escritas).
#
# Usa rutas absolutas de OneLake, así que no depende de tener un Lakehouse predeterminado adjunto.

# %%
import json
import uuid
from datetime import datetime, timezone

from pyspark.sql import DataFrame, Window
from pyspark.sql import functions as F

# Marcadores: desplegar_notebook.py los sustituye por FABRIC_WORKSPACE_ID y FABRIC_LAKEHOUSE_ID de .env.
WORKSPACE_ID = "<WORKSPACE_ID>"
LAKEHOUSE_ID = "<LAKEHOUSE_ID>"
BASE = f"abfss://{WORKSPACE_ID}@onelake.dfs.fabric.microsoft.com/{LAKEHOUSE_ID}"
BRONZE = f"{BASE}/Files/bronze"
SILVER = f"{BASE}/Tables/silver"

ID_EJECUCION = uuid.uuid4().hex[:12]
INICIO = datetime.now(timezone.utc)
# Los datos son pequeños: 200 particiones de shuffle (valor por defecto) solo añadirían latencia.
spark.conf.set("spark.sql.shuffle.partitions", "8")
print(f"Ejecución {ID_EJECUCION} · {INICIO.isoformat()}")

# %% [markdown]
# ## Reglas por tabla
# Cada regla es una expresión SQL que debe ser **cierta** para que la fila sea válida.
# El orden del diccionario importa: una tabla solo puede referenciar tablas ya procesadas.

# %%
TABLAS = {
    "proveedores": {
        "textos": ["codigo", "nombre", "ciudad", "pais", "condiciones_pago", "telefono"],
        "reglas": {
            "codigo_obligatorio": "codigo IS NOT NULL AND codigo <> ''",
            "nombre_obligatorio": "nombre IS NOT NULL AND nombre <> ''",
            "cif_formato": "cif RLIKE '^[A-Z0-9]{8,12}$'",
            "plazo_en_rango": "plazo_entrega_dias BETWEEN 0 AND 365",
            "estado_valido": "estado IN ('activo','en_revision','bloqueado','inactivo')",
        },
        "referencias": {},
    },
    "almacenes": {
        "textos": ["codigo", "nombre", "ciudad"],
        "reglas": {"codigo_obligatorio": "codigo IS NOT NULL AND codigo <> ''"},
        "referencias": {},
    },
    "productos": {
        "textos": ["sku", "nombre", "categoria", "unidad"],
        "reglas": {
            "sku_obligatorio": "sku IS NOT NULL AND sku <> ''",
            "categoria_obligatoria": "categoria IS NOT NULL AND categoria <> ''",
            "coste_no_negativo": "coste_estandar >= 0",
            "minimo_no_negativo": "stock_minimo >= 0",
            "lote_positivo": "lote_compra > 0",
        },
        "referencias": {"proveedor_preferente_id": "proveedores"},
    },
    "pedidos_compra": {
        "textos": ["numero"],
        "reglas": {
            "estado_valido": "estado IN ('borrador','enviado','parcial','recibido','cancelado')",
            "entrega_no_anterior_al_pedido": "fecha_entrega_prevista >= fecha_pedido",
            "pedido_no_futuro": "fecha_pedido <= current_date()",
        },
        "referencias": {"proveedor_id": "proveedores", "almacen_id": "almacenes"},
    },
    "lineas_pedido": {
        "textos": [],
        "reglas": {"cantidad_positiva": "cantidad > 0", "precio_no_negativo": "precio_unitario >= 0"},
        "referencias": {"pedido_id": "pedidos_compra", "producto_id": "productos"},
    },
    "recepciones": {
        "textos": ["albaran"],
        "reglas": {
            "albaran_obligatorio": "albaran IS NOT NULL AND albaran <> ''",
            "recepcion_no_futura": "fecha_recepcion <= current_date()",
        },
        "referencias": {"pedido_id": "pedidos_compra"},
    },
    "lineas_recepcion": {
        "textos": [],
        "reglas": {
            "cantidades_no_negativas": "cantidad_recibida >= 0 AND cantidad_rechazada >= 0",
            "alguna_cantidad": "cantidad_recibida + cantidad_rechazada > 0",
        },
        "referencias": {"recepcion_id": "recepciones", "linea_pedido_id": "lineas_pedido"},
    },
    "movimientos_stock": {
        "textos": ["referencia"],
        "reglas": {
            "tipo_valido": "tipo IN ('ENTRADA_COMPRA','SALIDA_CONSUMO','AJUSTE','INICIAL')",
            "cantidad_distinta_de_cero": "cantidad <> 0",
            "signo_coherente": "(tipo <> 'ENTRADA_COMPRA' OR cantidad > 0) AND (tipo <> 'SALIDA_CONSUMO' OR cantidad < 0)",
            "coste_no_negativo": "coste_unitario >= 0",
            "movimiento_no_futuro": "fecha <= current_timestamp()",
        },
        "referencias": {"producto_id": "productos", "almacen_id": "almacenes", "recepcion_id": "recepciones"},
    },
}

# %% [markdown]
# ## Funciones de transformación

# %%
def leer_bronze(tabla: str) -> DataFrame:
    """Todas las cargas de la tabla. mergeSchema tolera columnas añadidas en cargas posteriores."""
    return spark.read.option("mergeSchema", "true").parquet(f"{BRONZE}/{tabla}")


def deduplicar(df: DataFrame) -> DataFrame:
    """Una fila por clave: la de la carga más reciente."""
    w = Window.partitionBy("id").orderBy(F.col("_fecha_carga").desc(), F.col("_id_carga").desc())
    return df.withColumn("_rn", F.row_number().over(w)).filter("_rn = 1").drop("_rn")


def normalizar(df: DataFrame, textos: list[str]) -> DataFrame:
    for c in textos:
        if c in df.columns:
            limpio = F.regexp_replace(F.trim(F.col(c)), r"\s+", " ")
            df = df.withColumn(c, F.when(limpio == "", None).otherwise(limpio))
    if "cif" in df.columns:
        df = df.withColumn("cif", F.upper(F.regexp_replace("cif", r"[\s\-.]", "")))
    if "email" in df.columns:
        df = df.withColumn("email", F.lower(F.trim("email")))
    for c in ("codigo", "sku", "numero"):
        if c in df.columns:
            df = df.withColumn(c, F.upper(c))
    # Fechas: los DATE de origen se fuerzan a tipo date; los instantes se conservan en UTC y se añade su fecha.
    for c, t in df.dtypes:
        if c.startswith("fecha_") and t == "string":
            df = df.withColumn(c, F.to_date(c))
    if "fecha" in df.columns:
        df = df.withColumn("fecha_dia", F.to_date("fecha"))
    return df


def validar(df: DataFrame, reglas: dict[str, str], referencias: dict[str, str], silver: dict[str, DataFrame]) -> DataFrame:
    """Añade _errores: lista (texto) de reglas incumplidas; vacío si la fila es válida."""
    marcas = []
    for nombre, expr in reglas.items():
        cond = F.expr(expr)
        marcas.append(F.when(cond.isNull() | ~cond, F.lit(nombre)))  # un NULL en la regla también es un fallo
    for columna, tabla_ref in referencias.items():
        ids = silver[tabla_ref].select(F.col("id").alias(f"_ref_{columna}")).distinct()
        df = df.join(F.broadcast(ids), df[columna] == ids[f"_ref_{columna}"], "left")
        marcas.append(F.when(F.col(columna).isNotNull() & F.col(f"_ref_{columna}").isNull(), F.lit(f"referencia_{columna}_inexistente")))
    df = df.withColumn("_errores", F.concat_ws("; ", *marcas))
    return df.drop(*[f"_ref_{c}" for c in referencias])

# %% [markdown]
# ## Proceso

# %%
silver: dict[str, DataFrame] = {}
resultados = []

for tabla, cfg in TABLAS.items():
    t0 = datetime.now(timezone.utc)
    bruto = leer_bronze(tabla)
    leidas = bruto.count()
    cargas = bruto.select("_id_carga").distinct().count()

    unico = normalizar(deduplicar(bruto), cfg["textos"])
    marcado = validar(unico, cfg["reglas"], cfg["referencias"], silver).cache()
    claves = marcado.count()

    malas = marcado.filter("_errores <> ''")
    rechazadas = malas.count()
    if rechazadas:
        (malas.select(
            F.lit(ID_EJECUCION).alias("id_ejecucion"), F.lit(tabla).alias("tabla"), F.col("id").cast("long").alias("id_registro"),
            F.col("_errores").alias("errores"), F.col("_id_carga").alias("id_carga"),
            F.to_json(F.struct(*[c for c in malas.columns if not c.startswith("_")])).alias("registro"),
            F.current_timestamp().alias("detectado_en"))
         .write.format("delta").mode("append").save(f"{SILVER}/calidad_rechazos"))

    buenas = marcado.filter("_errores = ''").drop("_errores").withColumn("_procesado_en", F.current_timestamp())
    buenas.write.format("delta").mode("overwrite").option("overwriteSchema", "true").save(f"{SILVER}/{tabla}")
    silver[tabla] = spark.read.format("delta").load(f"{SILVER}/{tabla}")  # las referencias se validan contra lo ya escrito
    marcado.unpersist()

    r = {
        "id_ejecucion": ID_EJECUCION, "tabla": tabla, "cargas_leidas": cargas, "filas_leidas": leidas,
        "duplicadas_eliminadas": leidas - claves, "rechazadas": rechazadas, "escritas": claves - rechazadas,
        "segundos": round((datetime.now(timezone.utc) - t0).total_seconds(), 1),
    }
    resultados.append(r)
    print(r)

# %% [markdown]
# ## Registro de la ejecución y comprobaciones finales

# %%
log = spark.createDataFrame(resultados).withColumn("ejecutado_en", F.lit(INICIO.isoformat()).cast("timestamp"))
log.write.format("delta").mode("append").save(f"{SILVER}/calidad_ejecuciones")
display(log.select("tabla", "cargas_leidas", "filas_leidas", "duplicadas_eliminadas", "rechazadas", "escritas", "segundos"))

# Control cruzado: el stock derivado del libro de movimientos no puede ser negativo en ningún producto/almacén.
negativos = (silver["movimientos_stock"].groupBy("producto_id", "almacen_id").agg(F.sum("cantidad").alias("stock")).filter("stock < 0").count())
print(f"Combinaciones producto/almacén con stock negativo: {negativos}")
assert negativos == 0, "El libro de movimientos produce stock negativo: revisar la carga"

resumen = {
    "id_ejecucion": ID_EJECUCION,
    "filas_leidas": sum(r["filas_leidas"] for r in resultados),
    "duplicadas_eliminadas": sum(r["duplicadas_eliminadas"] for r in resultados),
    "rechazadas": sum(r["rechazadas"] for r in resultados),
    "escritas": sum(r["escritas"] for r in resultados),
}
print(json.dumps(resumen))
