"""Fuerza la sincronización de metadatos del punto de conexión SQL del Lakehouse.
Las tablas Delta recién escritas pueden tardar en aparecer en T-SQL; en un proceso encadenado
(notebook → Warehouse) hay que refrescar explícitamente antes de consultar.   Uso: python fabric/refrescar_sql_endpoint.py"""
from __future__ import annotations

import json
import sys

from auth import leer_env
from desplegar_notebook import Fabric

ws = leer_env()["FABRIC_WORKSPACE_ID"]
f = Fabric()
_, lista, _ = f.llamar("GET", f"/workspaces/{ws}/sqlEndpoints")
ep = next(e for e in lista["value"] if e["displayName"] == "lh_businessflow")
estado, cuerpo, cab = f.llamar("POST", f"/workspaces/{ws}/sqlEndpoints/{ep['id']}/refreshMetadata", {})
if estado == 202:
    import time
    url = cab.get("Location")
    while True:
        time.sleep(int(cab.get("Retry-After", 5)))
        _, op, cab2 = f.llamar("GET", url)
        if op.get("status") in ("Succeeded", "Failed"):
            if op["status"] == "Succeeded":
                _, cuerpo, _ = f.llamar("GET", url + "/result")
            else:
                print(json.dumps(op, indent=1), file=sys.stderr)
                sys.exit(1)
            break
for t in cuerpo.get("value", []):
    print(f"{t.get('tableName'):<32}{t.get('status'):<12}{(t.get('error') or {}).get('message', '')}")
