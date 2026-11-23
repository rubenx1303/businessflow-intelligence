"""Lee desde el equipo local las tablas Delta de control de calidad de Silver en OneLake y las muestra.
Sirve para comprobar el resultado de una ejecución sin abrir el portal.   Uso: python fabric/verificar_silver.py"""
from __future__ import annotations

import sys

from deltalake import DeltaTable

from auth import ALCANCE_ONELAKE, credencial, leer_env

env = leer_env()
ws, lh = env["FABRIC_WORKSPACE_ID"], env["FABRIC_LAKEHOUSE_ID"]
opciones = {"bearer_token": credencial().get_token(ALCANCE_ONELAKE).token, "use_fabric_endpoint": "true"}
base = f"abfss://{ws}@onelake.dfs.fabric.microsoft.com/{lh}/Tables/silver"


def leer(tabla: str):
    return DeltaTable(f"{base}/{tabla}", storage_options=opciones).to_pyarrow_table(engine="datafusion").to_pylist()


ejec = sorted(leer("calidad_ejecuciones"), key=lambda r: (r["ejecutado_en"], r["tabla"]))
ultima = ejec[-1]["id_ejecucion"]
print(f"Última ejecución: {ultima} ({ejec[-1]['ejecutado_en']})")
print(f"{'tabla':<20}{'cargas':>7}{'leídas':>9}{'duplic.':>9}{'rechaz.':>9}{'escritas':>10}{'seg':>7}")
tot = [0, 0, 0, 0]
for r in (r for r in ejec if r["id_ejecucion"] == ultima):
    print(f"{r['tabla']:<20}{r['cargas_leidas']:>7}{r['filas_leidas']:>9}{r['duplicadas_eliminadas']:>9}{r['rechazadas']:>9}{r['escritas']:>10}{r['segundos']:>7}")
    for i, k in enumerate(("filas_leidas", "duplicadas_eliminadas", "rechazadas", "escritas")):
        tot[i] += r[k]
print(f"{'TOTAL':<20}{'':>7}{tot[0]:>9}{tot[1]:>9}{tot[2]:>9}{tot[3]:>10}")

try:
    rech = [r for r in leer("calidad_rechazos") if r["id_ejecucion"] == ultima]
    print(f"\nRechazos de esta ejecución: {len(rech)}")
    for r in rech[:15]:
        print(f"  {r['tabla']} id={r['id_registro']}: {r['errores']}")
except Exception as e:  # la tabla no existe si nunca ha habido rechazos
    print(f"\nSin tabla de rechazos todavía ({type(e).__name__}).")
sys.exit(0)
