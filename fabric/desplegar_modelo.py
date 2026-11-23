"""
Genera y despliega el modelo semántico de Power BI (Direct Lake sobre las tablas Gold del Lakehouse).

    python fabric/desplegar_modelo.py              genera fabric/modelo/model.bim y lo despliega por API
    python fabric/desplegar_modelo.py --solo-generar

El modelo es código: las columnas se leen del esquema real de las tablas Delta, y relaciones y medidas
se declaran aquí y en modelo/medidas.py. No hace falta Power BI Desktop.
Direct Lake: Power BI lee los Parquet de las tablas Delta directamente desde OneLake, sin importar ni duplicar datos.
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

import pyarrow as pa
from deltalake import DeltaTable

from auth import ALCANCE_ONELAKE, credencial, leer_env
from desplegar_notebook import Fabric
from modelo.medidas import MEDIDAS

NOMBRE = "BusinessFlow Compras e Inventario"
DIR = Path(__file__).resolve().parent / "modelo"

# nombre en el modelo → tabla Delta en gold
TABLAS = {
    "DimFecha": "dim_fecha", "DimProducto": "dim_producto", "DimProveedor": "dim_proveedor", "DimAlmacen": "dim_almacen",
    "FactCompras": "fact_compras", "FactRecepciones": "fact_recepciones", "FactMovimientosInventario": "fact_movimientos_inventario",
}
# (tabla muchos, columna, tabla uno, columna, activa)
RELACIONES = [
    ("FactCompras", "fecha_pedido_key", "DimFecha", "fecha_key", True),
    ("FactCompras", "fecha_entrega_prevista_key", "DimFecha", "fecha_key", False),  # se activa con USERELATIONSHIP
    ("FactCompras", "producto_key", "DimProducto", "producto_key", True),
    ("FactCompras", "proveedor_key", "DimProveedor", "proveedor_key", True),
    ("FactCompras", "almacen_key", "DimAlmacen", "almacen_key", True),
    ("FactRecepciones", "fecha_recepcion_key", "DimFecha", "fecha_key", True),
    ("FactRecepciones", "producto_key", "DimProducto", "producto_key", True),
    ("FactRecepciones", "proveedor_key", "DimProveedor", "proveedor_key", True),
    ("FactRecepciones", "almacen_key", "DimAlmacen", "almacen_key", True),
    ("FactMovimientosInventario", "fecha_key", "DimFecha", "fecha_key", True),
    ("FactMovimientosInventario", "producto_key", "DimProducto", "producto_key", True),
    ("FactMovimientosInventario", "almacen_key", "DimAlmacen", "almacen_key", True),
]
ORDENAR_POR = {("DimFecha", "nombre_mes"): "mes", ("DimFecha", "anio_mes"): "anio_mes_orden", ("DimFecha", "nombre_dia"): "dia_semana"}


def tipo_tmsl(t: pa.DataType) -> str:
    if pa.types.is_integer(t):
        return "int64"
    if pa.types.is_decimal(t):
        return "decimal"
    if pa.types.is_floating(t):
        return "double"
    if pa.types.is_boolean(t):
        return "boolean"
    if pa.types.is_date(t) or pa.types.is_timestamp(t):
        return "dateTime"
    return "string"


def construir(servidor_sql: str, id_endpoint: str) -> dict:
    env = leer_env()
    opciones = {"bearer_token": credencial().get_token(ALCANCE_ONELAKE).token, "use_fabric_endpoint": "true"}
    base = f"abfss://{env['FABRIC_WORKSPACE_ID']}@onelake.dfs.fabric.microsoft.com/{env['FABRIC_LAKEHOUSE_ID']}/Tables/gold"

    tablas = []
    for nombre, delta in TABLAS.items():
        esquema = DeltaTable(f"{base}/{delta}", storage_options=opciones).to_pyarrow_table(engine="datafusion").schema
        es_hecho = nombre.startswith("Fact")
        columnas = []
        for campo in esquema:
            col = {"name": campo.name, "dataType": tipo_tmsl(campo.type), "sourceColumn": campo.name, "summarizeBy": "none"}
            if campo.name.endswith("_key") or campo.name.endswith("_id"):
                col["isHidden"] = es_hecho or campo.name.endswith("_key")  # las claves no se arrastran a un informe
            if pa.types.is_date(campo.type):
                col["formatString"] = "dd/mm/yyyy"
            if (nombre, campo.name) in ORDENAR_POR:
                col["sortByColumn"] = ORDENAR_POR[(nombre, campo.name)]
            if nombre == "DimFecha" and campo.name == "fecha":
                col["isKey"] = True
                col["isHidden"] = False
            columnas.append(col)
        tabla = {
            "name": nombre, "columns": columnas,
            "partitions": [{"name": nombre, "mode": "directLake", "source": {
                "type": "entity", "entityName": delta, "schemaName": "gold", "expressionSource": "DatabaseQuery"}}],
            "measures": [
                {"name": n, "expression": expr.split("\n"), "formatString": fmt, "displayFolder": carpeta, "description": desc}
                for (t, carpeta, n, fmt, desc, expr) in MEDIDAS if t == nombre],
        }
        if nombre == "DimFecha":
            tabla["dataCategory"] = "Time"  # tabla de fechas: habilita la inteligencia de tiempo (DATEADD, TOTALYTD…)
        if not tabla["measures"]:
            del tabla["measures"]
        tablas.append(tabla)

    return {
        "compatibilityLevel": 1604,
        "model": {
            "culture": "es-ES", "collation": "Latin1_General_100_BIN2_UTF8",
            "defaultPowerBIDataSourceVersion": "powerBI_V3", "discourageImplicitMeasures": True,
            "tables": tablas,
            "relationships": [
                {"name": f"{a}_{ca}__{b}", "fromTable": a, "fromColumn": ca, "toTable": b, "toColumn": cb, **({} if activa else {"isActive": False})}
                for (a, ca, b, cb, activa) in RELACIONES],
            "expressions": [{"name": "DatabaseQuery", "kind": "m", "expression": [
                "let", f'    database = Sql.Database("{servidor_sql}", "{id_endpoint}")', "in", "    database"]}],
            "annotations": [{"name": "PBI_QueryOrder", "value": '["DatabaseQuery"]'}],
        },
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--solo-generar", action="store_true")
    a = p.parse_args()
    env = leer_env()
    ws, lh = env["FABRIC_WORKSPACE_ID"], env["FABRIC_LAKEHOUSE_ID"]
    f = Fabric()
    _, lakehouse, _ = f.llamar("GET", f"/workspaces/{ws}/lakehouses/{lh}")
    sql = lakehouse["properties"]["sqlEndpointProperties"]

    bim = construir(sql["connectionString"], sql["id"])
    (DIR / "model.bim").write_text(json.dumps(bim, ensure_ascii=False, indent=2), encoding="utf-8")
    n_medidas = sum(len(t.get("measures", [])) for t in bim["model"]["tables"])
    print(f"model.bim generado: {len(bim['model']['tables'])} tablas, {len(bim['model']['relationships'])} relaciones, {n_medidas} medidas")
    if a.solo_generar:
        return 0

    b64 = lambda s: base64.b64encode(s.encode("utf-8")).decode()
    definicion = {"parts": [
        {"path": "model.bim", "payload": b64(json.dumps(bim, ensure_ascii=False)), "payloadType": "InlineBase64"},
        {"path": "definition.pbism", "payload": b64(json.dumps({"version": "4.0", "settings": {}})), "payloadType": "InlineBase64"},
    ]}
    _, lista, _ = f.llamar("GET", f"/workspaces/{ws}/semanticModels")
    existente = next((m for m in lista.get("value", []) if m["displayName"] == NOMBRE), None)
    if existente:
        estado, _, cab = f.llamar("POST", f"/workspaces/{ws}/semanticModels/{existente['id']}/updateDefinition", {"definition": definicion})
        if estado == 202:
            f.esperar_operacion(cab, "La actualización del modelo")
        print(f"Modelo actualizado: {existente['id']}")
    else:
        estado, cuerpo, cab = f.llamar("POST", f"/workspaces/{ws}/semanticModels", {"displayName": NOMBRE, "definition": definicion})
        if estado == 202:
            f.esperar_operacion(cab, "La creación del modelo")
        _, lista, _ = f.llamar("GET", f"/workspaces/{ws}/semanticModels")
        print(f"Modelo creado: {next(m['id'] for m in lista['value'] if m['displayName'] == NOMBRE)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
