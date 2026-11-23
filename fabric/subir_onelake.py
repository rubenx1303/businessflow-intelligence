"""
Sube la zona Bronze local (data/lake/Files/bronze) a OneLake, a la sección Files del Lakehouse.

OneLake expone la API de ADLS Gen2: el "contenedor" es el área de trabajo y la ruta empieza por el Lakehouse.
    https://onelake.dfs.fabric.microsoft.com/<workspace_id>/<lakehouse_id>/Files/bronze/...

Autenticación: inicio de sesión interactivo con Microsoft Entra ID (se abre el navegador). No hay secretos
en el repositorio ni en .env; el token se guarda en la caché cifrada del sistema operativo.

Idempotente: un archivo ya subido con el mismo tamaño no se vuelve a enviar (los Parquet de una carga son inmutables).

Uso:  python fabric/subir_onelake.py            (lee FABRIC_WORKSPACE_ID y FABRIC_LAKEHOUSE_ID de .env)
"""
from __future__ import annotations

import json
import sys

from azure.core.exceptions import ResourceNotFoundError
from azure.storage.filedatalake import DataLakeServiceClient

from auth import RAIZ, credencial, leer_env

ORIGEN = RAIZ / "data" / "lake" / "Files" / "bronze"


def main() -> int:
    env = leer_env()
    ws, lh = env.get("FABRIC_WORKSPACE_ID"), env.get("FABRIC_LAKEHOUSE_ID")
    if not ws or not lh:
        print("Faltan FABRIC_WORKSPACE_ID o FABRIC_LAKEHOUSE_ID en .env", file=sys.stderr)
        return 2
    if not ORIGEN.exists():
        print(f"No existe {ORIGEN}. Ejecuta antes: npm run export:bronze", file=sys.stderr)
        return 2

    servicio = DataLakeServiceClient("https://onelake.dfs.fabric.microsoft.com", credential=credencial())
    fs = servicio.get_file_system_client(ws)

    subidos, omitidos, total_bytes = 0, 0, 0
    for archivo in sorted(p for p in ORIGEN.rglob("*") if p.is_file()):
        destino = f"{lh}/Files/bronze/{archivo.relative_to(ORIGEN).as_posix()}"
        cliente = fs.get_file_client(destino)
        tam = archivo.stat().st_size
        es_estado = archivo.name == "_estado.json"  # único archivo mutable: se sobrescribe siempre
        if not es_estado:
            try:
                if cliente.get_file_properties().size == tam:
                    omitidos += 1
                    continue
            except ResourceNotFoundError:
                pass
        with archivo.open("rb") as f:
            cliente.upload_data(f, overwrite=True, length=tam)
        subidos += 1
        total_bytes += tam
        print(f"  ↑ {destino.split('/', 1)[1]}  ({tam:,} bytes)")

    print(json.dumps({"subidos": subidos, "omitidos": omitidos, "bytes": total_bytes,
                      "destino": f"onelake://{ws}/{lh}/Files/bronze"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
