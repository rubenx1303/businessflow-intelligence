"""Lee las tablas Gold desde OneLake (Delta) y muestra recuentos, esquema y los totales de control.
Uso: python fabric/verificar_gold.py"""
from __future__ import annotations

from deltalake import DeltaTable

from auth import ALCANCE_ONELAKE, credencial, leer_env

env = leer_env()
opciones = {"bearer_token": credencial().get_token(ALCANCE_ONELAKE).token, "use_fabric_endpoint": "true"}
base = f"abfss://{env['FABRIC_WORKSPACE_ID']}@onelake.dfs.fabric.microsoft.com/{env['FABRIC_LAKEHOUSE_ID']}/Tables/gold"

TABLAS = ["dim_fecha", "dim_producto", "dim_proveedor", "dim_almacen", "fact_compras", "fact_recepciones", "fact_movimientos_inventario"]
datos = {}
for t in TABLAS:
    dt = DeltaTable(f"{base}/{t}", storage_options=opciones)
    datos[t] = dt.to_pyarrow_table(engine="datafusion")
    print(f"{t:<30}{datos[t].num_rows:>8} filas  v{dt.version()}  {[f'{c.name}:{c.type}' for c in datos[t].schema][:4]}…")

c = datos["fact_compras"].to_pylist()
validos = [r for r in c if r["estado_pedido"] not in ("borrador", "cancelado")]
print("\nTotales de control")
print(f"  importe de compras        {sum(r['importe'] for r in validos)}")
print(f"  pedidos                   {len({r['pedido_id'] for r in c})}")
print(f"  unidades recibidas        {sum(r['cantidad_recibida'] for r in c)}")
print(f"  stock total (movimientos) {sum(r['cantidad'] for r in datos['fact_movimientos_inventario'].to_pylist())}")
completos = {r["pedido_id"]: r["pedido_a_tiempo"] for r in c if r["pedido_completo"]}
print(f"  entregas puntuales        {sum(completos.values()) / len(completos):.4%} de {len(completos)} pedidos completos")
