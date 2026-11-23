"""
Despliega un notebook en el área de trabajo de Fabric por API REST y, opcionalmente, lo ejecuta y espera el resultado.

    python fabric/desplegar_notebook.py fabric/notebooks/01_bronze_a_silver.ipynb --ejecutar

- Los marcadores <WORKSPACE_ID> y <LAKEHOUSE_ID> del notebook se sustituyen por los valores de .env al desplegar.
- Si el notebook no existe se crea; si existe se actualiza su definición (despliegue idempotente).
- La ejecución usa el planificador de trabajos de Fabric (jobType=RunNotebook), igual que haría una canalización.
Es la base de un despliegue continuo: el mismo script puede correr en GitHub Actions con una entidad de servicio.
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from auth import ALCANCE_FABRIC, credencial, leer_env

API = "https://api.fabric.microsoft.com/v1"


class Fabric:
    def __init__(self) -> None:
        self.cred = credencial()

    def llamar(self, metodo: str, url: str, cuerpo: dict | None = None) -> tuple[int, dict, dict]:
        if not url.startswith("http"):
            url = API + url
        datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
        peticion = urllib.request.Request(url, data=datos, method=metodo, headers={
            "Authorization": f"Bearer {self.cred.get_token(ALCANCE_FABRIC).token}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(peticion, timeout=120) as r:
                texto = r.read().decode() or "{}"
                return r.status, json.loads(texto), dict(r.headers)
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{metodo} {url} → HTTP {e.code}: {e.read().decode()[:800]}") from None

    def esperar_operacion(self, cabeceras: dict, que: str) -> None:
        """Operaciones de larga duración: 202 + Location hasta que el estado sea Succeeded."""
        url = cabeceras.get("Location")
        while url:
            time.sleep(int(cabeceras.get("Retry-After", 5)))
            _, cuerpo, cabeceras = self.llamar("GET", url)
            estado = cuerpo.get("status")
            if estado == "Succeeded":
                return
            if estado in ("Failed", "Undefined"):
                raise RuntimeError(f"{que} falló: {json.dumps(cuerpo)[:800]}")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("notebook", type=Path)
    p.add_argument("--ejecutar", action="store_true")
    a = p.parse_args()

    env = leer_env()
    ws, lh = env.get("FABRIC_WORKSPACE_ID"), env.get("FABRIC_LAKEHOUSE_ID")
    if not ws or not lh:
        print("Faltan FABRIC_WORKSPACE_ID o FABRIC_LAKEHOUSE_ID en .env", file=sys.stderr)
        return 2
    nombre = a.notebook.stem
    contenido = a.notebook.read_text(encoding="utf-8").replace("<WORKSPACE_ID>", ws).replace("<LAKEHOUSE_ID>", lh)
    definicion = {"format": "ipynb", "parts": [{
        "path": "notebook-content.ipynb", "payloadType": "InlineBase64",
        "payload": base64.b64encode(contenido.encode("utf-8")).decode()}]}

    f = Fabric()
    _, lista, _ = f.llamar("GET", f"/workspaces/{ws}/items?type=Notebook")
    existente = next((i for i in lista.get("value", []) if i["displayName"] == nombre), None)
    if existente:
        item = existente["id"]
        estado, _, cab = f.llamar("POST", f"/workspaces/{ws}/items/{item}/updateDefinition", {"definition": definicion})
        if estado == 202:
            f.esperar_operacion(cab, "La actualización")
        print(f"Notebook actualizado: {nombre} ({item})")
    else:
        estado, cuerpo, cab = f.llamar("POST", f"/workspaces/{ws}/items", {"displayName": nombre, "type": "Notebook", "definition": definicion})
        if estado == 202:
            f.esperar_operacion(cab, "La creación")
            _, lista, _ = f.llamar("GET", f"/workspaces/{ws}/items?type=Notebook")
            cuerpo = next(i for i in lista["value"] if i["displayName"] == nombre)
        item = cuerpo["id"]
        print(f"Notebook creado: {nombre} ({item})")

    if not a.ejecutar:
        return 0

    _, _, cab = f.llamar("POST", f"/workspaces/{ws}/items/{item}/jobs/instances?jobType=RunNotebook", {})
    url = cab["Location"]
    print(f"Ejecución lanzada: {url.rsplit('/', 1)[-1]}", flush=True)
    t0, ultimo = time.time(), None
    while True:
        time.sleep(15)
        _, trabajo, _ = f.llamar("GET", url)
        estado = trabajo.get("status")
        if estado != ultimo:
            print(f"  [{int(time.time() - t0):>4}s] {estado}", flush=True)
            ultimo = estado
        if estado in ("Completed", "Failed", "Cancelled", "Deduped"):
            break
    if estado != "Completed":
        print(json.dumps(trabajo.get("failureReason"), ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    print(f"Completado en {int(time.time() - t0)} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
