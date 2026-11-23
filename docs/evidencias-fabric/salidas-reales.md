# Salidas reales de la ejecución en Microsoft Fabric (23/11/2026)

Texto devuelto por los scripts del repositorio contra el entorno real de Fabric, copiado tal cual salvo los identificadores del entorno (área de trabajo, Lakehouse, elementos y trabajos), sustituidos por marcadores como `<WORKSPACE_ID>`. No se ha regenerado ni se ha vuelto a ejecutar: la capacidad está en pausa.

## 1. Subida de Bronze a OneLake — `python fabric/subir_onelake.py`

```
{"subidos": 18, "omitidos": 0, "bytes": 290714, "destino": "onelake://<WORKSPACE_ID>/<LAKEHOUSE_ID>/Files/bronze"}
```

## 2. Notebook Bronze → Silver — `python fabric/desplegar_notebook.py … --ejecutar`

```
Notebook creado: 01_bronze_a_silver (<NOTEBOOK_ID>)
Ejecución lanzada: <JOB_ID>
  [  15s] NotStarted
  [ 126s] InProgress
  [ 172s] Completed
Completado en 172 s
```

Lectura de la tabla Delta de control desde el equipo local — `python fabric/verificar_silver.py`:

```
Última ejecución: 0ce27be73a7b (2026-11-23 17:31:48.868509+00:00)
tabla                cargas   leídas  duplic.  rechaz.  escritas    seg
almacenes                 2        6        3        0         3    3.8
lineas_pedido             2     4050     2025        0      2025    4.4
lineas_recepcion          2     4496     2248        0      2248    4.1
movimientos_stock         1    35102        0        0     35102    3.9
pedidos_compra            2     1910      955        0       955    4.7
productos                 2       80       40        0        40    5.8
proveedores               2       18        9        0         9    9.0
recepciones               2     2158     1079        0      1079    2.9
TOTAL                          47820     6359        0     41461

Sin tabla de rechazos todavía (TableNotFoundError).
```

## 3. Notebook Silver → Gold

```
Notebook creado: 02_silver_a_gold (<NOTEBOOK_ID>)
Ejecución lanzada: <JOB_ID>
Completado en 532 s
```

`python fabric/verificar_gold.py`:

```
dim_fecha                          730 filas  v0
dim_producto                        40 filas  v0
dim_proveedor                        9 filas  v0
dim_almacen                          3 filas  v0
fact_compras                      2025 filas  v0
fact_recepciones                  2248 filas  v0
fact_movimientos_inventario      35102 filas  v0

Totales de control
  importe de compras        1842763.8286
  pedidos                   955
  unidades recibidas        213168.000
  stock total (movimientos) 6220.000
  entregas puntuales        77.4364% de 944 pedidos completos
```

## 4. Warehouse — `python fabric/desplegar_warehouse.py`

```
Warehouse creado: wh_businessflow
✓ 01_esquema_y_vistas.sql [1/4] SCHEMA analitica  (0.0s)
✓ 01_esquema_y_vistas.sql [2/4] VIEW analitica.vw_gasto_mensual  (0.0s)
✓ 01_esquema_y_vistas.sql [3/4] VIEW analitica.vw_rendimiento_proveedor  (0.0s)
✓ 01_esquema_y_vistas.sql [4/4] VIEW analitica.vw_puntualidad_trimestral  (0.0s)
✓ 02_inventario_diario.sql [1/3] PROCEDURE analitica.sp_cargar_inventario_diario  (0.0s)
✓ 02_inventario_diario.sql [2/3] EXEC analitica.sp_cargar_inventario_diario  (6.0s)
✓ 02_inventario_diario.sql [3/3] VIEW analitica.vw_stock_actual  (0.0s)
```

Consulta a `analitica.vw_rendimiento_proveedor`:

```
codigo   compl  gasto      cuota  otd    retraso  acordado  real_d  pct_rechazo
PRV-001  127    716825.23  38.90  92.13  0.20     3         3.02    0.002
PRV-005  112    270628.09  14.69  54.46  2.27     8         10.20   0.312
PRV-002  132    241503.53  13.11  83.33  0.67     5         5.53    0.281
PRV-004  141    178257.76  9.67   85.82  0.62     6         6.45    0.053
PRV-008  86     161797.30  8.78   87.21  0.50     6         6.37    0.021
PRV-003  130    135432.87  7.35   66.15  1.42     4         5.35    0.265
PRV-006  118    100462.45  5.45   72.03  1.30     9         10.20   0.034
PRV-007  98     37856.60   2.05   77.55  1.04     7         7.92    0.457
```

Consulta a `analitica.vw_puntualidad_trimestral` (proveedor PRV-005):

```
codigo   anio  trimestre  pedidos  pct_puntual  variacion_puntos
PRV-005  2025  4          8        62.50
PRV-005  2026  1          30       70.00        7.50
PRV-005  2026  2          36       63.89        -6.11
PRV-005  2026  3          29       27.59        -36.30
PRV-005  2026  4          9        44.44        16.85
```

Foto de inventario:

```
filas  valor     stock     bajo_minimo  stock_min
43800  55927.77  6220.000  6            0.000
```

## 5. Modelo semántico y medidas DAX — `python fabric/consultar_dax.py`

```
model.bim generado: 7 tablas, 12 relaciones, 30 medidas
Modelo creado: <SEMANTIC_MODEL_ID>
Actualización del modelo: Completed

── Indicadores globales ──
  Coste total de compras              1,842,763.8286
  Pedidos                                        955
  % Entregas puntuales                        0.7744
  Retraso medio (días)                        0.9947
  Valor del inventario                     55,927.77
  Productos bajo mínimo                            6
  Consumo valorado                      1,899,723.73
  Rotación de inventario                     33.9674
  % Rechazo                                   0.0011
  Desviación sobre estándar %                 0.0005

── Consumo e inventario por categoría ──
categoria              Consumo valorado  Cuota %  Valor inventario  Rotación  Bajo mínimo
Bebidas                      743,438.53   0.3913         18,043.57   41.3156            1
Desechables y envases         277,595.8   0.1461           4,838.5   57.3723            3
Café e infusiones             248,025.8   0.1306          10,918.3   22.7789
Limpieza e higiene            184,129.9   0.0969           5,766.7   31.9299
Aceites y condimentos         166,392.5   0.0876           6,203.6   26.8219
Alimentación seca             139,108.4   0.0732           5,272.2   26.4578
Conservas                     102,428.5   0.0539           3,456.9   29.7116            2
Menaje                         38,604.3   0.0203             1,428   27.1081

── Valor del inventario al cierre de cada trimestre (semiaditivo) ──
anio  trimestre  Valor al cierre  Consumo valorado
2025          4        42,050.64         190,608.8
2026          1        48,986.92        396,005.54
2026          2        66,470.62        490,448.96
2026          3        56,445.01        574,451.63
2026          4        55,927.77         248,208.8
```

Tras corregir el ranking (segunda ejecución):

```
codigo   Gasto         Cuota %  Ranking  % Puntual  Retraso  Desv. plazo  % Rechazo
PRV-001  716,825.2268    0.389        1     0.9213   0.2047       0.0157          0
PRV-005    270,628.09   0.1469        2     0.5446   2.2679       2.1964     0.0031
PRV-007   37,856.6048   0.0205        8     0.7755   1.0408       0.9184     0.0046
```

## Capturas

Las capturas del portal de Azure (capacidad en pausa y lista de recursos de la suscripción) no se incluyen en la copia pública porque muestran identificadores de la cuenta y de la suscripción.
