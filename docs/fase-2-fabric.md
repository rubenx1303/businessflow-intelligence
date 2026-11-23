# Fase 2 — Ingeniería de datos en Microsoft Fabric (en curso)

## Recursos creados (23/11/2026)

| Recurso | Nombre | Detalle |
|---|---|---|
| Suscripción | Azure for Students | 100 USD de crédito, sin tarjeta, en el inquilino institucional de un centro de formación |
| Grupo de recursos | `rg-bfi-fabric` | Spain Central |
| Capacidad de Fabric | `bfifabricdev` | **F2**, Spain Central, *overage protection* desactivada. 321,20 USD/mes estimados si estuviera siempre encendida (≈0,44 USD/h) |
| Área de trabajo | BusinessFlow Intelligence - DEV | Asignada a `bfifabricdev` |
| Lakehouse | `lh_businessflow` | Con esquemas habilitados |
| Notebook | `01_bronze_a_silver` | Desplegado y ejecutado por API REST |

Incidencia resuelta: la suscripción de estudiante lleva la directiva *Allowed resource deployment regions*. West Europe está bloqueada; Spain Central, France Central, Poland Central, Denmark East y Switzerland sí están permitidas.

## Circuito ejecutado

```
PostgreSQL ──DuckDB──► Parquet local ──subir_onelake.py (API ADLS Gen2)──► OneLake  Files/bronze
                                                                              │
                                              01_bronze_a_silver (PySpark)    ▼
                                                                       Tables/silver (Delta)
```

1. `npm run export:bronze` — extracción con manifiesto y reconciliación.
2. `python fabric/subir_onelake.py` — 18 archivos (290.714 bytes) a `Files/bronze`. Idempotente.
3. `python fabric/desplegar_notebook.py fabric/notebooks/01_bronze_a_silver.ipynb --ejecutar` — crea o actualiza el notebook y lo lanza con el planificador de trabajos de Fabric. Completado en 172 s (incluye el arranque de Spark).
4. `python fabric/verificar_silver.py` — lee las tablas Delta de control desde el equipo local.

## Resultado de la primera ejecución (id `0ce27be73a7b`)

| Tabla | Cargas | Leídas | Duplicadas | Rechazadas | Escritas |
|---|---:|---:|---:|---:|---:|
| almacenes | 2 | 6 | 3 | 0 | 3 |
| proveedores | 2 | 18 | 9 | 0 | 9 |
| productos | 2 | 80 | 40 | 0 | 40 |
| pedidos_compra | 2 | 1.910 | 955 | 0 | 955 |
| lineas_pedido | 2 | 4.050 | 2.025 | 0 | 2.025 |
| recepciones | 2 | 2.158 | 1.079 | 0 | 1.079 |
| lineas_recepcion | 2 | 4.496 | 2.248 | 0 | 2.248 |
| movimientos_stock | 1 | 35.102 | 0 | 0 | 35.102 |
| **Total** | | **47.820** | **6.359** | **0** | **41.461** |

Las 41.461 filas escritas coinciden con el recuento del origen en PostgreSQL. Los 6.359 duplicados son reales: las tablas en instantánea completa se cargaron dos veces y Silver conserva la versión más reciente de cada clave. El libro de movimientos, incremental, no generó duplicados.

## Limitaciones conocidas

- **Las reglas de rechazo no se han visto actuar**: el origen tiene restricciones de integridad y no produjo filas inválidas. Falta una carga de prueba con datos defectuosos para demostrar la cuarentena.
- **La ingesta no usa Data Factory todavía**: PostgreSQL es local y una canalización de Fabric no lo alcanza sin una puerta de enlace de datos. Hoy la ingesta es un script; la orquestación con canalización queda pendiente.
- Pendiente: Gold (modelo en estrella), Warehouse, modelo semántico y DAX.

## Control de costes

- La capacidad factura por tiempo encendida, se use o no. **Hay que pausarla al terminar** (portal de Azure → `bfifabricdev` → Pausar).
- Durante las sesiones la capacidad se compartió con otro proyecto de pruebas: se pausaba al terminar el último trabajo.

## Gold y Warehouse (23/11/2026, segunda sesión)

Notebook `02_silver_a_gold` (PySpark + Spark SQL), ejecutado en Fabric en 532 s (la capacidad estaba compartida con otro proyecto). Escribe en `Tables/gold`:

| Tabla | Granularidad | Filas |
|---|---|---:|
| `dim_fecha` | día | 730 |
| `dim_producto` | producto (SCD1) | 40 |
| `dim_proveedor` | proveedor (SCD1) | 9 |
| `dim_almacen` | almacén | 3 |
| `fact_compras` | línea de pedido | 2.025 |
| `fact_recepciones` | línea de recepción | 2.248 |
| `fact_movimientos_inventario` | movimiento de stock | 35.102 |

El notebook comprueba que cada clave es única, que ninguna clave foránea queda huérfana y que importes y stock cuadran con Silver; si algo falla, la ejecución aborta.

Warehouse `wh_businessflow` (creado por API, scripts en `fabric/warehouse/`), esquema `analitica`:

| Objeto | Qué demuestra |
|---|---|
| `vw_gasto_mensual` | `LAG`, acumulado anual y media móvil con funciones de ventana |
| `vw_rendimiento_proveedor` | Reducción de grano (línea → pedido) antes de agregar, `DENSE_RANK`, cuota sobre total |
| `vw_puntualidad_trimestral` | Variación entre trimestres por proveedor |
| `sp_cargar_inventario_diario` → `inventario_diario` | Procedimiento almacenado con CTAS: foto periódica diaria (43.800 filas) por suma acumulada |
| `vw_stock_actual` | Última foto frente al stock mínimo |

Las vistas leen el Lakehouse con nombres de tres partes (`lh_businessflow.gold.…`), sin copiar datos.

### Cuadre con la aplicación

| Indicador | PostgreSQL / aplicación | Fabric |
|---|---:|---:|
| Importe de compras | 1.842.763,83 | 1.842.763,83 |
| Entregas puntuales | 77,44 % | 77,44 % (944 pedidos) |
| Valor del inventario | 55.927,77 | 55.927,77 |
| Productos bajo mínimo | 6 | 6 |
| Gasto de diciembre de 2025 | 153.538 | 153.538,50 |

Fabric refleja la carga Bronze de las 15:57 UTC. Después se creó en la aplicación un pedido de prueba (83,40 €) que aún no se ha vuelto a cargar.

### Incidencia: retraso de sincronización del punto de conexión SQL

`gold.dim_proveedor` existía en Delta pero no aparecía en T-SQL minutos después. Se resolvió forzando el refresco de metadatos por API (`fabric/refrescar_sql_endpoint.py`). En un proceso encadenado notebook → Warehouse este paso debe ser explícito.

### Sigue pendiente

- Carga de prueba con datos defectuosos para ver actuar la cuarentena de Silver.
- Canalización de Data Factory que orqueste los pasos (hoy se lanzan con scripts).
- Modelo semántico, medidas DAX e informe de Power BI.

## Modelo semántico y DAX (23/11/2026, tercera sesión)

Modelo **BusinessFlow Compras e Inventario**, en modo **Direct Lake** sobre las tablas Gold del Lakehouse. Se define como código (`fabric/desplegar_modelo.py` genera `fabric/modelo/model.bim` leyendo el esquema real de las tablas Delta) y se despliega por API; no ha hecho falta Power BI Desktop.

- 7 tablas (DimFecha marcada como tabla de fechas), 12 relaciones (una inactiva: fecha de entrega prevista, para `USERELATIONSHIP`).
- 30 medidas DAX en `fabric/modelo/medidas.py`, agrupadas en Compras, Evolución, Proveedores, Inventario y Consumo.
- Medidas implícitas desactivadas: todo indicador pasa por una medida explícita.

Patrones DAX presentes: filtros en `CALCULATE`, inteligencia de tiempo (`DATEADD`, `TOTALYTD`, `DATESINPERIOD`), reducción de grano con `SUMMARIZE` + `AVERAGEX`, medida semiaditiva de stock por suma acumulada, `RANKX` con `ALLSELECTED`, cuotas con `REMOVEFILTERS`, iteradores (`SUMX` sobre la dimensión).

### Validación (`python fabric/consultar_dax.py`)

Las medidas se ejecutan contra el modelo por la API de Power BI y se comparan con la aplicación:

| Medida | Aplicación | DAX |
|---|---:|---:|
| Coste total de compras | 1.842.763,83 | 1.842.763,83 |
| % Entregas puntuales | 77,44 % | 77,44 % |
| Retraso medio (días) | 0,9947 | 0,9947 |
| Valor del inventario | 55.927,77 | 55.927,77 |
| Productos bajo mínimo | 6 | 6 |
| Consumo valorado | 1.899.723,73 | 1.899.723,73 |
| Rotación de inventario | 33,97 | 33,97 |

Defectos encontrados y corregidos al validar:
- `Ranking de proveedor por gasto` devolvía 1 para todos: `ALLSELECTED` liberaba solo la clave y el filtro de la columna visible seguía activo. Ahora se aplica sobre la tabla.
- `Variación mensual del gasto %` daba −100 % en meses futuros sin gasto, y `Desviación de plazo` mostraba un valor para un proveedor sin pedidos. Ahora devuelven vacío.

### Sigue pendiente

- Informe de Power BI (páginas y narrativa) sobre este modelo.
- RLS en el modelo (por ejemplo, por almacén).
- Canalización de Data Factory y carga de prueba con datos defectuosos.
