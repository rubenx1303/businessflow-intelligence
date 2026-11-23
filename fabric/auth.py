"""Autenticación compartida con Microsoft Entra ID para los scripts de Fabric/OneLake.

Inicio de sesión interactivo la primera vez; después se reutiliza la caché cifrada del sistema operativo.
No se guarda ningún secreto en el repositorio ni en .env.
"""
from __future__ import annotations

import os
from pathlib import Path

from azure.identity import AuthenticationRecord, InteractiveBrowserCredential, TokenCachePersistenceOptions

RAIZ = Path(__file__).resolve().parent.parent
REGISTRO = Path.home() / ".businessflow" / "registro_autenticacion.json"
ALCANCE_ONELAKE = "https://storage.azure.com/.default"
ALCANCE_FABRIC = "https://api.fabric.microsoft.com/.default"


def leer_env() -> dict[str, str]:
    valores = dict(os.environ)
    ruta = RAIZ / ".env"
    if ruta.exists():
        for linea in ruta.read_text(encoding="utf-8-sig").splitlines():
            if "=" in linea and not linea.lstrip().startswith("#"):
                k, v = linea.split("=", 1)
                valores.setdefault(k.strip(), v.strip())
    return valores


def credencial() -> InteractiveBrowserCredential:
    cache = TokenCachePersistenceOptions(name="businessflow")
    if REGISTRO.exists():
        registro = AuthenticationRecord.deserialize(REGISTRO.read_text(encoding="utf-8"))
        return InteractiveBrowserCredential(cache_persistence_options=cache, authentication_record=registro)
    cred = InteractiveBrowserCredential(cache_persistence_options=cache)
    print("Se abrirá el navegador: elige tu cuenta de trabajo para autorizar el acceso...", flush=True)
    registro = cred.authenticate(scopes=[ALCANCE_ONELAKE])
    REGISTRO.parent.mkdir(parents=True, exist_ok=True)
    REGISTRO.write_text(registro.serialize(), encoding="utf-8")  # solo identifica la cuenta; no contiene tokens
    return cred
