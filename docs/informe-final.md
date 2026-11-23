# Informe final — BusinessFlow Intelligence

Fecha: 23/11/2026 · Rama: `main`

Este informe está escrito para que un tercero pueda comprobar el trabajo. Cada afirmación indica cómo verificarla. Lo no verificado se señala como tal.

## 1. Resumen

BusinessFlow es una aplicación de compras e inventario con un circuito de datos medallion. Funciona completa en local con datos ficticios, sin Azure. El mismo circuito se ejecutó y validó en Microsoft Fabric el 23/11/2026; ese entorno está en pausa y se conserva el código y las evidencias.

## 2. Funcionalidades implementadas

| Área | Funcionalidad | Dónde |
|---|---|---|
| Operativa | Proveedores (alta, edición, búsqueda, estados, historial) | `server/src/routes/proveedores.ts` |
| Operativa | Productos, almacenes, existencias, movimientos, salidas y ajustes | `server/src/routes/inventario.ts` |
| Operativa | Pedidos con líneas, envío, cancelación, recepciones parciales con rechazos | `server/src/routes/pedidos.ts` |
| Seguridad | JWT, cuatro roles, validación con zod, auditoría, límite de intentos de acceso | `server/src/http.ts`, `routes/auth.ts` |
| Analítica en vivo | Panel con filtros de fechas, almacén, categoría, proveedor y producto | `server/src/services/panel.ts` |
| Analítica en vivo | Reposición por reglas, rendimiento de proveedores, costes | `server/src/services/{reposicion,analitica}.ts` |
| Datos | Bronze: extracción PostgreSQL → Parquet, completa e incremental, con manifiesto y reconciliación | `server/src/data/exportBronze.ts` |
| Datos | Silver: deduplicación, normalización, 25 reglas de calidad, 11 comprobaciones de referencia, cuarentena | `server/src/data/medallion.ts` |
| Datos | Gold: 4 dimensiones, 3 hechos y foto diaria de inventario, con controles | `server/src/data/medallion.ts` |
| Datos | Informes sobre Gold y cuadre contra la base operativa | `server/src/services/informes.ts` |
| Demo | Acceso con un clic por rol, restauración de datos, arranque en Windows | `routes/auth.ts`, `routes/datos.ts`, `iniciar-demo.cmd` |
| Interfaz | Panel, Proveedores, Inventario, Compras, Inteligencia, Informes, Datos, Auditoría; claro/oscuro; adaptable a móvil | `web/src/pages/` |
| Fabric | Subida a OneLake, 2 notebooks PySpark, Warehouse T-SQL, modelo semántico con 30 medidas DAX, despliegue por API | `fabric/` |

## 3. Funcionalidades pendientes o no implementadas

- Informe de Power BI sobre el modelo semántico.
- Canalización de Data Factory y Dataflow Gen2 (la orquestación en Fabric se hizo con scripts).
- Dataverse y Power Apps.
- Seguridad a nivel de fila (RLS) e integración con Entra ID en la aplicación.
- Multiempresa: el esquema lleva `empresa_id` y las consultas operativas filtran por él, pero solo hay una empresa y **el circuito medallion no separa por empresa**.
- Despliegue: no hay. El flujo de CI (`.github/workflows/ci.yml`) está escrito pero todavía no se ha ejecutado.
- Real-Time Intelligence, KQL, Eventstreams, dbt, Metabase: no utilizados.
- Pruebas automatizadas de interfaz: no hay; la interfaz se verificó a mano en el navegador.

## 4. Arquitectura real

```
web (React, Vite, Tailwind)  ──►  server (Express, TypeScript)  ──►  PostgreSQL 16 (Docker)
                                         │
                                         └─ DuckDB (en proceso) ──► data/lake/Files/bronze ──► data/lake/silver ──► data/lake/gold
```

- El **panel** y la pestaña **Inteligencia** consultan PostgreSQL en vivo.
- **Informes** consulta los Parquet de Gold con DuckDB.
- El circuito se lanza desde la interfaz (`POST /api/datos/pipeline`), por comando (`npm run pipeline`) o al arrancar.
- La carpeta `fabric/` es independiente: son scripts Python que solo se usan contra Fabric. Ni `server/` ni `web/` importan nada de Azure.

Modelo Gold y granularidad:

| Tabla | Una fila por |
|---|---|
| `dim_fecha` | día natural |
| `dim_producto`, `dim_proveedor`, `dim_almacen` | entidad (SCD tipo 1) |
| `fact_compras` | línea de pedido |
| `fact_recepciones` | línea de recepción |
| `fact_movimientos_inventario` | movimiento de stock |
| `inventario_diario` | producto, almacén y día (foto periódica) |

## 5. Archivos importantes

| Archivo | Contenido |
|---|---|
| `iniciar-demo.cmd`, `scripts/iniciar-demo.ps1` | Arranque en Windows |
| `docker-compose.yml`, `.env.example` | Base de datos y configuración (sin secretos) |
| `server/src/db/migrations/001_esquema_inicial.sql` | Esquema operativo |
| `server/src/db/seed.ts` | Simulador determinista de 12 meses |
| `server/src/data/{exportBronze,medallion,lake}.ts` | Circuito medallion local |
| `server/src/services/{panel,informes,analitica,reposicion}.ts` | Cálculo de indicadores |
| `server/tests/*.test.ts` | 37 pruebas |
| `web/src/pages/{Dashboard,Informes,Datos}.tsx` | Panel, informes y circuito |
| `fabric/notebooks/*.py` | Notebooks PySpark (fuente) y `.ipynb` generados |
| `fabric/warehouse/*.sql` | Vistas y procedimiento T-SQL |
| `fabric/modelo/medidas.py`, `fabric/modelo/model.bim` | 30 medidas DAX y modelo semántico |
| `fabric/{subir_onelake,desplegar_notebook,desplegar_warehouse,desplegar_modelo,consultar_dax,verificar_silver,verificar_gold,refrescar_sql_endpoint}.py` | Despliegue y verificación en Fabric |
| `docs/evidencias-fabric/` | Salidas reales y resumen |
| `docs/capturas/` | Nueve capturas de la aplicación |

## 6. Pruebas ejecutadas y resultados

### 6.1 Automatizadas

Comando: `npm test`. Resultado de la última ejecución: **3 archivos, 37 pruebas, 37 superadas, 0 fallidas** (29 s). Usan la base `businessflow_test` y el lake `data/lake_test`, nunca los de la demo.

| Requisito | Prueba que lo cubre | Resultado |
|---|---|---|
| La base de datos funciona | `api.test.ts` completo (16 pruebas) | Superada |
| Los datos de demostración se generan | «se generan de forma determinista y coherente», «volver a sembrar produce exactamente los mismos datos» | Superada |
| Bronze, Silver y Gold se ejecutan | «Bronze conserva los datos originales…», «Gold respeta la granularidad…», «una segunda ejecución es incremental…» | Superada |
| Los indicadores son correctos | «los indicadores calculados sobre Gold coinciden con los de la base operativa» (8 medidas) y contraste con SQL directo | Superada |
| Los filtros funcionan | Tres pruebas de «filtros del panel» (proveedor, producto, categoría, fechas, rango invertido) | Superada |
| Las operaciones modifican los resultados | «un pedido recibido cambia el panel al momento…», «una salida de stock reduce el inventario…» | Superada |
| Silver valida y aparta datos inválidos | «rechaza con su motivo los registros inválidos y normaliza los válidos» | Superada |
| Restaurar la demo | «solo el administrador puede, y deja datos y lake como al principio» | Superada |
| Funciona con Fabric desactivado | Toda la batería se ejecuta con la capacidad en pausa y sin credenciales de Azure | Superada |

Otras comprobaciones:

- Tipos: `npx tsc --noEmit` en `server/` sin errores. `npm run build -w web` sin errores.
- Dependencias ocultas de Azure: búsqueda de `azure|onelake|fabric.microsoft|powerbi.com|api.fabric` en `server/src`, `web/src`, los `package.json`, `docker-compose.yml` y `scripts/`. Solo aparecen 7 menciones en comentarios y textos de la interfaz; ninguna URL, SDK o llamada de red.
- Script de arranque: ejecutado con éxito con los servicios ya en marcha (los seis pasos). **No se ha probado desde un equipo limpio**: la creación de `.env`, la instalación de dependencias y la apertura de las ventanas de la API y la web no se han ejercitado.

### 6.2 Manuales en el navegador

Realizadas a mano en Chrome sobre `http://localhost:5180`: acceso de demo como Administración; Panel (indicadores, gráfico mensual, proveedores, distribución de retrasos, alertas); Informes (cuadre con las ocho medidas en «Coincide»); Datos (cinco etapas, tablas de Bronze y Silver, sección de Fabric); Inteligencia, Compras e Inventario. Capturas en `docs/capturas/`.

Realizadas en una sesión anterior de revisión, según sus notas (no repetidas en la última revisión):

- Alta y edición de proveedor y de producto, alta de almacén, salida de stock, ajuste con motivo y cancelación de un borrador.
- Secuencia completa: pedido de 20 cajas de BEB-008 → envío → recepción; el panel pasó de 1.842.847 € a 1.843.057 € y el stock de 51 a 71; Informes marcó el cuadre como desfasado; tras ejecutar el pipeline (9,7 s) volvió a cuadrar.
- Restauración de la demo desde «Datos» (unos 40 s).
- Permisos por rol: Almacén ve «Ejecutar pipeline» pero no «Restaurar demo»; Dirección no ve ninguno.
- Tema claro, oscuro y ancho móvil (375 px) en Panel, Informes, Datos y acceso.

No verificado en la interfaz: los filtros de Informes uno a uno; el estado «todavía no hay capa Gold»; la lista de filas rechazadas (con los datos de la demo no hay rechazos); los botones de restaurar de la barra lateral y del menú móvil; el detalle visual de la mitad inferior de «Datos» en tema oscuro salvo la captura 06; los botones del rol Compras.

## 7. Evidencias de Fabric existentes

Todo procede de la sesión del 23/11/2026. No se ha vuelto a ejecutar nada en Fabric.

| Evidencia | Archivo |
|---|---|
| Salidas literales de los scripts (subida, notebooks, Warehouse, DAX) | `docs/evidencias-fabric/salidas-reales.md` |
| Resumen estructurado que muestra la aplicación | `docs/evidencias-fabric/resumen.json` |
| Código desplegado | `fabric/` |

Cifras clave: Silver 47.820 leídas, 6.359 duplicadas, 0 rechazadas, 41.461 escritas (172 s); Gold 7 tablas (532 s); Warehouse 4 vistas y 1 procedimiento; modelo con 7 tablas, 12 relaciones y 30 medidas; ocho medidas DAX idénticas a la aplicación.

Limitación de las evidencias: son texto. Los identificadores del entorno se han sustituido por marcadores, y las dos capturas del portal de Azure que existen no se publican porque muestran datos de la cuenta y de la suscripción. **No hay capturas del portal de Fabric** (área de trabajo, Lakehouse, notebooks o modelo); con la capacidad en pausa ya no se pueden obtener sin encenderla.

## 8. Estado de los recursos de Azure

Comprobado en el portal de Azure el 23/11/2026, después de las 19:00:

| Recurso | Estado |
|---|---|
| Suscripción «Azure for Students» (inquilino institucional de un centro de formación) | Activa, 100 USD de crédito inicial, sin tarjeta |
| Grupo de recursos `rg-bfi-fabric` | Existe |
| Capacidad Fabric `bfifabricdev` (F2, Spain Central) | **En pausa** |
| Otros recursos en la suscripción | Ninguno (la lista muestra 1 de 1) |

En Fabric siguen existiendo, inaccesibles mientras la capacidad esté en pausa: el área de trabajo «BusinessFlow Intelligence - DEV» con el Lakehouse, dos notebooks, el Warehouse y el modelo semántico. Otro proyecto de pruebas creó su propia área de trabajo en la misma capacidad; no forma parte de este repositorio.

La capacidad estuvo encendida de 18:21 a 18:58 aproximadamente (unos 37 minutos). No se ha eliminado ningún recurso.

## 9. Posibles costes residuales

| Concepto | ¿Genera coste en pausa? | Comentario |
|---|---|---|
| Cómputo de la capacidad F2 | No | Solo factura mientras está activa (≈0,44 USD/h según la estimación de 321,20 USD/mes del portal) |
| Almacenamiento en OneLake | **Sí, en principio** | Según la documentación de Microsoft el almacenamiento se factura aparte del cómputo. Aquí son pocos megabytes: el importe sería de céntimos o menos, con cargo al crédito |
| Grupo de recursos, área de trabajo vacía | No | |
| Reanudación accidental | Sí | Si alguien pulsa «Reanudar», vuelve a facturar hasta que se pause |

No verificado: el consumo real del crédito. El análisis de costes de Azure tarda horas en reflejarlo y no se ha consultado.

No puede haber cargos en dinero real: la suscripción no tiene tarjeta y se desactiva al agotar el crédito.

Para llegar a coste cero absoluto habría que **eliminar** la capacidad (y, con ella, dejar inaccesible el contenido del área de trabajo). No se ha hecho: es una decisión del propietario.

## 10. Instrucciones para ejecutar la demo

1. Tener Node.js 22+ y Docker Desktop.
2. Doble clic en `iniciar-demo.cmd`, en la raíz del proyecto.
3. En `http://localhost:5180`, pulsar «Entrar como Administración».
4. Para parar: cerrar las dos ventanas de PowerShell y ejecutar `detener-demo.cmd`.

Comprobaciones rápidas para un revisor:

```
npm test                 # 37 pruebas
npm run pipeline         # ejecuta Bronze → Silver → Gold y muestra el resultado por tabla
npm run build            # tipos del servidor y compilación de la web
```

## 11. Problemas encontrados

| Problema | Resolución |
|---|---|
| La cuenta original no tenía capacidad de Fabric y las pruebas estaban deshabilitadas | Azure for Students y capacidad F2 con crédito |
| El asistente de Azure proponía F64 por defecto | Cambiada a F2; desactivada la protección de sobrecoste |
| Directiva de regiones de la suscripción de estudiante (West Europe bloqueada) | Spain Central |
| La importación de notebooks por la interfaz no era automatizable | Despliegue por API REST |
| El punto de conexión SQL no veía una tabla Delta recién escrita | Refresco de metadatos por API (`refrescar_sql_endpoint.py`) |
| Tres medidas DAX incorrectas (ranking siempre 1; valores en filas sin datos) | Corregidas y revalidadas |
| Las reglas de rechazo no se pudieron demostrar en Fabric | Demostradas en local con una prueba que inyecta datos defectuosos |
| Las pruebas compartían base de datos y dependían del orden de ejecución | Cada archivo parte de una base vacía |
| El script de arranque abortaba en PowerShell 5.1 por la salida de error de Docker | Llamadas a Docker a través de `cmd /c` |
| Archivos escritos con marca BOM rompían la lectura de `package.json` | BOM eliminado |
| La pantalla «Datos» quedaba en blanco con la marca de agua incremental | Corregido; cada pantalla aísla sus fallos de pintado |
| La distribución de retrasos no aplicaba los filtros de categoría y producto | Corregido en `panel.ts` |
| La carga completa etiquetaba los movimientos como «incremental» | Corregido en `exportBronze.ts` |
| La siembra no era repetible dentro del mismo proceso | El generador se reinicia en cada siembra |

Conocidos y no resueltos:

- Si se borra `.env` conservando el volumen de Docker, la contraseña nueva no coincide con la de la base. Solución: `docker compose down -v` y volver a arrancar.
- El almacén de destino por defecto de un pedido nuevo es el primero por orden alfabético.
- Bronze acumula una instantánea completa de las tablas maestras en cada ejecución; no hay política de retención.
- La primera extracción descarga la extensión de PostgreSQL para DuckDB y necesita conexión a Internet esa vez.

## 12. Decisiones técnicas

| Decisión | Motivo |
|---|---|
| El stock se deriva de un libro de movimientos de solo inserción | Auditable; es directamente una tabla de hechos |
| Recepción en una única transacción y bloqueos consultivos por producto y almacén | Coherencia y ausencia de stock negativo bajo concurrencia |
| DuckDB para extracción y transformaciones locales | Sin servidor ni JVM; el circuito completo tarda uno o dos segundos |
| Misma lógica en dos motores (DuckDB y PySpark) | La demo no depende de la nube y el código de Fabric se conserva |
| Panel en vivo e informes sobre Gold, con cuadre visible | Enseña la diferencia entre dato operativo y dato analítico y prueba que coinciden |
| Modelo semántico generado como código | No requiere Power BI Desktop y se versiona |
| Acceso de demo sin contraseña solo con `DEMO_MODE=true` | Facilita enseñarlo; desactivado por defecto |
| Evidencias de Fabric como archivos estáticos | No se simulan ejecuciones ni se consulta Azure |
| PostgreSQL en Docker; API y web con npm | Arranque simple sin instalar una base de datos en Windows |
| dbt y Metabase descartados | No aportaban nada que el proyecto no cubriera ya |

## 13. Historial de commits

Verificable con `git log --oneline`. Esta copia pública agrupa el desarrollo en pocos commits; el historial por fases se conserva en el repositorio de trabajo.
