# Fase 0 — Auditoría del entorno (23/11/2026)

## Equipo local

| Herramienta | Estado |
|---|---|
| Node 24.20, npm 11.19 | Instalado |
| Git 2.55, GitHub CLI | Instalado |
| Docker Desktop 29.9 | Instalado (hubo que arrancarlo) |
| Python 3.11 | Instalado (sin pyarrow/pyspark) |
| PostgreSQL nativo, Java, Azure CLI, dbt, DuckDB CLI | No instalados |
| Power BI Desktop | No instalado |
| RAM 31 GB, 65 GB libres en C: | Suficiente |

PostgreSQL se ejecuta en Docker y DuckDB como dependencia npm, así que no ha hecho falta instalar nada en el sistema.

## Microsoft Fabric

Comprobado en el navegador con la sesión ya iniciada (app.fabric.microsoft.com):

- **Inquilino:** inquilino institucional de un centro de formación (cuenta de estudiante).
- **Licencia:** «Cuenta gratuita».
- **Prueba de Fabric:** *«Su organización ha deshabilitado las pruebas individuales de Power BI y Fabric»*.
- **Áreas de trabajo:** solo «Mi área de trabajo», vacía y sin capacidad asignada.
- **Elementos que el portal permite crear:** Flujo de datos Gen2, Modelo semántico, Informe, Informe paginado, Panel, Tarjeta de resultados, Exploración y varias bases de datos reflejadas.
- **Elementos que NO aparecen:** Lakehouse, Warehouse, Notebook, Canalización de datos (Data Factory), Eventstream, base de datos KQL.

**Conclusión:** con esta cuenta no se puede ejecutar la arquitectura medallion en Fabric. No se ha creado ningún recurso ni activado nada.

## Cómo desbloquear Fabric (decisión del usuario)

| Opción | Coste | Notas |
|---|---|---|
| A. Pedir al administrador del inquilino del centro que habilite la prueba de Fabric o asigne una capacidad | 0 € | La más simple si acceden; depende de terceros |
| B. Inquilino propio con cuenta profesional nueva + prueba gratuita de Fabric (60 días) | 0 € | Requiere crear una cuenta Microsoft Entra propia; control total, incluidos Entra ID y RLS |
| C. Capacidad F2 de Azure en pago por uso, pausándola al terminar cada sesión | ~0,3–0,4 €/h encendida (precio orientativo, sin verificar) | Requiere suscripción de Azure y tarjeta; excelente para demostrar control de costes |

Dataverse y Power Apps dependen igualmente de la licencia del inquilino; no se han evaluado todavía.

## Riesgos de coste

- Ninguno incurrido. Todo lo construido es local y gratuito.
- En Fabric el coste lo determina la **capacidad**, no los elementos: una capacidad F de Azure factura mientras está encendida aunque no se use.
