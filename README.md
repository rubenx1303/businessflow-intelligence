# BusinessFlow Intelligence

Aplicación de compras, recepciones e inventario para una pyme, con una API REST sobre PostgreSQL, una aplicación web en React y una primera capa de datos (Bronze) que extrae las tablas operativas a Parquet con trazabilidad por carga.

Todos los datos son ficticios: los genera un simulador determinista que reproduce 12 meses de actividad de un distribuidor de suministros de hostelería. Las empresas, personas, teléfonos e identificadores fiscales que aparecen son inventados (los CIF de demostración tienen la forma `DEMO0000n` y los correos usan el dominio reservado `.example`).

## Estado

| Elemento | Estado |
|---|---|
| API REST (Express 5, TypeScript, validación con zod, JWT y control de acceso por rol) | Implementado y con pruebas |
| Esquema PostgreSQL (migración SQL), vistas de existencias y de estado de líneas de pedido | Implementado |
| Registro de auditoría de las operaciones de escritura | Implementado |
| Simulador de datos (12 meses) | Implementado |
| Extracción PostgreSQL → Parquet (Bronze) con DuckDB, manifiesto y reconciliación | Implementado, ejecutado solo en local |
| Aplicación web React (panel, proveedores, inventario, compras, inteligencia, auditoría) | Implementada (consume la API) |
| Capas Silver y Gold, PySpark, modelo semántico, Power BI, Microsoft Fabric / OneLake | **No implementado (planificado)** |

## Arquitectura

```
React + Vite + Tailwind ──HTTP/JWT──► API Express (TypeScript, zod)
                                          │
                                          ▼
                                 PostgreSQL 16 (OLTP)
                                          │  DuckDB (conexión en modo READ_ONLY)
                                          ▼
                 data/lake/Files/bronze/<tabla>/fecha_carga=AAAA-MM-DD/<id_carga>.parquet

                 [planificado] Silver → Gold → modelo semántico / Power BI
```

La estructura de carpetas de Bronze sigue la convención `Files/` de un Lakehouse para poder cargarla más adelante en OneLake sin cambiar los consumidores. Esa integración no está hecha.

## Modelo de datos

Tablas operativas (todas con `empresa_id`, y todas las consultas de la API filtran por la empresa de la sesión): `empresas`, `usuarios`, `proveedores`, `almacenes`, `productos`, `pedidos_compra`, `lineas_pedido`, `recepciones`, `lineas_recepcion`, `movimientos_stock` y `auditoria`.

- **El stock se deriva, no se guarda.** `movimientos_stock` es un libro de solo inserción con cantidades con signo; las existencias se calculan en la vista `v_existencias`.
- **Una recepción es una única transacción**: albarán, entradas de stock (solo lo aceptado) y nuevo estado del pedido se confirman juntos.
- **Concurrencia**: `pg_advisory_xact_lock` por producto y almacén evita que dos salidas simultáneas dejen stock negativo; hay una prueba que lo comprueba.
- **Reposición por reglas** (`server/src/services/reposicion.ts`): stock de seguridad `z·σ·√L` (z = 1,65), punto de pedido `d·L + SS` y cantidad hasta cubrir el plazo más 30 días, redondeada al lote de compra. `L` es el plazo de entrega real medio observado del proveedor preferente; si todavía no hay entregas completas, se usa el plazo acordado.

Roles: `admin`, `compras`, `almacen` y `lectura`.

## Carga Bronze

`server/src/data/exportBronze.ts`:

- Tablas maestras y de pedidos: instantánea completa. `movimientos_stock`: incremental por marca de agua sobre `id`.
- Cada fila añade `_id_carga`, `_fecha_carga` y `_origen`.
- Cada ejecución escribe un manifiesto JSON con número de filas, hash SHA-256 y marca de agua por tabla.
- Antes de dar la carga por buena, se reconcilia el recuento y la unicidad de la clave del Parquet escrito contra el origen; si no cuadra, se borra el archivo y la carga falla.
- Además del script, un administrador puede consultar y lanzar cargas con `GET` / `POST /api/datos/cargas`.

## Puesta en marcha

Requisitos: Node 22 o superior, npm y Docker (solo para PostgreSQL).

```bash
cp .env.example .env        # cambia las contraseñas y JWT_SECRET (mínimo 32 caracteres)
npm ci
npm run db:up               # PostgreSQL 16 en Docker, expuesto en 127.0.0.1:5433
npm run db:migrate
npm run db:seed             # borra y regenera los datos simulados
npm run dev:api             # API en http://localhost:4000/api (salud: /api/salud)
npm run dev:web             # web en http://localhost:5180 (redirige /api a la API)
npm run export:bronze       # carga Bronze en data/lake; "npm run export:bronze -- --completa" fuerza recarga total
```

En Windows sin Bash, el primer paso es `copy .env.example .env`.

El seed crea un usuario administrador con `SEED_ADMIN_EMAIL` y tres usuarios más en el mismo dominio (`compras@`, `almacen@` y `direccion@`, con los roles compras, almacén y lectura), todos con la contraseña `SEED_ADMIN_PASSWORD`. Son credenciales de desarrollo local.

La primera ejecución de `export:bronze` necesita conexión a internet: DuckDB descarga su extensión `postgres`.

Para parar la base de datos: `npm run db:down`.

## Pruebas

Con la base de datos levantada (`npm run db:up`) y el `.env` creado:

```bash
npm test                    # Vitest + Supertest
npm run build               # comprobación de tipos de la API y compilación de la web
```

24 pruebas: autenticación y permisos por rol, validación y aislamiento entre empresas en proveedores, ciclo pedido → recepción → stock, concurrencia en salidas de stock, cálculo de reposición y puntuación de proveedores. Las pruebas de integración borran y vuelven a crear una base separada, `businessflow_test`; nunca usan la de desarrollo.

La integración continua (GitHub Actions, `.github/workflows/ci.yml`) ejecuta la comprobación de tipos, las pruebas contra un servicio PostgreSQL y la compilación de la web. Las contraseñas que aparecen en ese archivo son valores desechables solo para la ejecución de CI.

## Estructura

```
server/   API, migraciones SQL, simulador de datos, carga Bronze y pruebas
web/      aplicación React
docs/     notas de entorno (fase 0)
data/     lake local generado por export:bronze (no versionado)
```

## Próximos pasos (no implementados)

- Capa Silver (limpieza y tipado, previsiblemente con PySpark/Delta) y Gold (modelo en estrella sobre `movimientos_stock`, pedidos y recepciones).
- Despliegue de la capa de datos en un Lakehouse de Microsoft Fabric y modelo semántico en Power BI.

## Licencia

MIT. Ver [LICENSE](LICENSE).
