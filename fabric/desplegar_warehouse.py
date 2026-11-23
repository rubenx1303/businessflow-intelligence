"""
Crea (si no existe) el Warehouse de Fabric y ejecuta los scripts T-SQL de fabric/warehouse en orden.

    python fabric/desplegar_warehouse.py                 despliega todo
    python fabric/desplegar_warehouse.py --consulta "SELECT TOP 5 * FROM analitica.vw_gasto_mensual"

Conexión: punto de conexión TDS del Warehouse con token de Microsoft Entra ID (sin usuario ni contraseña SQL).
Los scripts son idempotentes (CREATE OR ALTER, DROP IF EXISTS), así que se puede relanzar en cada despliegue.
"""
from __future__ import annotations

import argparse
import re
import struct
import sys
import time
from pathlib import Path

import mssql_python

from auth import credencial, leer_env
from desplegar_notebook import Fabric

NOMBRE = "wh_businessflow"
DIR_SQL = Path(__file__).resolve().parent / "warehouse"
ALCANCE_SQL = "https://database.windows.net/.default"
SQL_COPT_SS_ACCESS_TOKEN = 1256


def obtener_warehouse(f: Fabric, ws: str) -> dict:
    _, lista, _ = f.llamar("GET", f"/workspaces/{ws}/warehouses")
    wh = next((w for w in lista.get("value", []) if w["displayName"] == NOMBRE), None)
    if wh is None:
        estado, cuerpo, cab = f.llamar("POST", f"/workspaces/{ws}/warehouses", {
            "displayName": NOMBRE, "description": "Capa de consumo T-SQL sobre el modelo Gold de BusinessFlow"})
        if estado == 202:
            f.esperar_operacion(cab, "La creación del Warehouse")
        print(f"Warehouse creado: {NOMBRE}")
    for _ in range(20):  # la cadena de conexión tarda unos segundos en estar disponible
        _, lista, _ = f.llamar("GET", f"/workspaces/{ws}/warehouses")
        wh = next((w for w in lista.get("value", []) if w["displayName"] == NOMBRE), None)
        if wh and wh.get("properties", {}).get("connectionString"):
            return wh
        time.sleep(6)
    raise RuntimeError("El Warehouse no expone cadena de conexión")


def conectar(servidor: str):
    token = credencial().get_token(ALCANCE_SQL).token.encode("utf-16-le")
    return mssql_python.connect(
        f"Server={servidor},1433;Database={NOMBRE};Encrypt=yes;TrustServerCertificate=no;",
        attrs_before={SQL_COPT_SS_ACCESS_TOKEN: struct.pack(f"<I{len(token)}s", len(token), token)}, autocommit=True)


def imprimir(cursor) -> None:
    columnas = [c[0] for c in cursor.description]
    filas = cursor.fetchall()
    anchos = [max(len(str(c)), *(len(str(f[i])) for f in filas)) if filas else len(str(c)) for i, c in enumerate(columnas)]
    print("  ".join(str(c).ljust(a) for c, a in zip(columnas, anchos)))
    for f in filas:
        print("  ".join(str(v if v is not None else "").ljust(a) for v, a in zip(f, anchos)))
    print(f"({len(filas)} filas)")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--consulta")
    a = p.parse_args()
    ws = leer_env()["FABRIC_WORKSPACE_ID"]
    wh = obtener_warehouse(Fabric(), ws)
    con = conectar(wh["properties"]["connectionString"])
    cur = con.cursor()

    if a.consulta:
        cur.execute(a.consulta)
        imprimir(cur)
        return 0

    for archivo in sorted(DIR_SQL.glob("*.sql")):
        lotes = [l.strip() for l in re.split(r"^\s*GO\s*$", archivo.read_text(encoding="utf-8"), flags=re.M | re.I) if l.strip()]
        for i, lote in enumerate(lotes, 1):
            t0 = time.time()
            try:
                cur.execute(lote)
            except Exception as e:
                print(f"✗ {archivo.name} lote {i}: {e}", file=sys.stderr)
                return 1
            objeto = re.search(r"(VIEW|PROCEDURE|EXEC|SCHEMA)\s+([\w.]+)", lote, flags=re.I)
            print(f"✓ {archivo.name} [{i}/{len(lotes)}] {objeto.group(0) if objeto else ''}  ({time.time() - t0:.1f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
