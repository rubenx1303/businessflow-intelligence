"""
Actualiza (reencuadra) el modelo semántico Direct Lake y ejecuta consultas DAX contra él por la API de Power BI.

    python fabric/consultar_dax.py                    ejecuta la batería de validación
    python fabric/consultar_dax.py "EVALUATE ROW(\"x\", [Stock])"
    python fabric/consultar_dax.py --sin-actualizar

Sirve como prueba de regresión del modelo: las medidas se comprueban sin abrir Power BI.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

from auth import credencial, leer_env

PBI = "https://api.powerbi.com/v1.0/myorg"
ALCANCE_PBI = "https://analysis.windows.net/powerbi/api/.default"
NOMBRE = "BusinessFlow Compras e Inventario"

VALIDACION = {
    "Indicadores globales": """EVALUATE ROW (
    "Coste total de compras", [Coste total de compras], "Pedidos", [Pedidos],
    "% Entregas puntuales", [% Entregas puntuales], "Retraso medio (días)", [Retraso medio (días)],
    "Valor del inventario", [Valor del inventario], "Productos bajo mínimo", [Productos bajo mínimo],
    "Consumo valorado", [Consumo valorado], "Rotación de inventario", [Rotación de inventario],
    "% Rechazo", [% Rechazo], "Desviación sobre estándar %", [Desviación sobre coste estándar %] )""",
    "Evolución mensual del gasto": """EVALUATE
SUMMARIZECOLUMNS ( DimFecha[anio_mes],
    "Gasto", [Coste total de compras], "Variación %", [Variación mensual del gasto %],
    "Acumulado año", [Gasto acumulado del año], "Media móvil 3m", [Gasto media móvil 3 meses] )
ORDER BY DimFecha[anio_mes]""",
    "Rendimiento por proveedor": """EVALUATE
SUMMARIZECOLUMNS ( DimProveedor[codigo],
    "Gasto", [Coste total de compras], "Cuota %", [Cuota de gasto %], "Ranking", [Ranking de proveedor por gasto],
    "% Puntual", [% Entregas puntuales], "Retraso", [Retraso medio (días)],
    "Desv. plazo", [Desviación de plazo (días)], "% Rechazo", [% Rechazo] )
ORDER BY [Gasto] DESC""",
    "Consumo e inventario por categoría": """EVALUATE
SUMMARIZECOLUMNS ( DimProducto[categoria],
    "Consumo valorado", [Consumo valorado], "Cuota %", [Cuota de consumo por categoría %],
    "Valor inventario", [Valor del inventario], "Rotación", [Rotación de inventario],
    "Bajo mínimo", [Productos bajo mínimo] )
ORDER BY [Consumo valorado] DESC""",
    "Valor del inventario al cierre de cada trimestre (semiaditivo)": """EVALUATE
SUMMARIZECOLUMNS ( DimFecha[anio], DimFecha[trimestre],
    "Valor al cierre", [Valor del inventario], "Consumo valorado", [Consumo valorado] )
ORDER BY DimFecha[anio], DimFecha[trimestre]""",
}


def llamar(metodo: str, ruta: str, cuerpo: dict | None = None):
    peticion = urllib.request.Request(PBI + ruta, method=metodo, data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
                                      headers={"Authorization": f"Bearer {credencial().get_token(ALCANCE_PBI).token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(peticion, timeout=180) as r:
            texto = r.read().decode("utf-8-sig")
            return json.loads(texto) if texto else {}
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{metodo} {ruta} → HTTP {e.code}: {e.read().decode()[:1200]}") from None


def mostrar(titulo: str, resultado: dict) -> None:
    filas = resultado["results"][0]["tables"][0].get("rows", [])
    print(f"\n── {titulo} ──")
    if not filas:
        print("(sin filas)")
        return
    limpia = lambda k: k.split("[")[-1].rstrip("]")
    fmt = lambda v: f"{v:,.4f}".rstrip("0").rstrip(".") if isinstance(v, float) else ("" if v is None else str(v))
    columnas = list(filas[0].keys())
    if len(filas) == 1 and len(columnas) > 6:
        for k in columnas:
            print(f"  {limpia(k):<32}{fmt(filas[0][k]):>18}")
        return
    anchos = [max(len(limpia(c)), *(len(fmt(f.get(c))) for f in filas)) for c in columnas]
    print("  ".join(limpia(c).ljust(a) for c, a in zip(columnas, anchos)))
    for f in filas:
        print("  ".join(fmt(f.get(c)).rjust(a) if isinstance(f.get(c), (int, float)) else fmt(f.get(c)).ljust(a) for c, a in zip(columnas, anchos)))


def main() -> int:
    ws = leer_env()["FABRIC_WORKSPACE_ID"]
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    modelo = next(d for d in llamar("GET", f"/groups/{ws}/datasets")["value"] if d["name"] == NOMBRE)["id"]

    if "--sin-actualizar" not in sys.argv:
        llamar("POST", f"/groups/{ws}/datasets/{modelo}/refreshes", {"type": "full"})
        while True:
            time.sleep(5)
            ultimo = llamar("GET", f"/groups/{ws}/datasets/{modelo}/refreshes?$top=1")["value"][0]
            if ultimo["status"] != "Unknown":  # Unknown = en curso
                break
        print(f"Actualización del modelo: {ultimo['status']}")
        if ultimo["status"] != "Completed":
            print(ultimo.get("serviceExceptionJson"), file=sys.stderr)
            return 1

    consultas = {"Consulta": args[0]} if args else VALIDACION
    for titulo, dax in consultas.items():
        mostrar(titulo, llamar("POST", f"/groups/{ws}/datasets/{modelo}/executeQueries",
                               {"queries": [{"query": dax}], "serializerSettings": {"includeNulls": True}}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
