"""Medidas DAX del modelo semántico. Cada medida: (tabla anfitriona, carpeta, nombre, formato, descripción, expresión).

Convenciones:
- Los pedidos en borrador o cancelados no son gasto: se excluyen en la medida base y el resto se construye sobre ella.
- La puntualidad se mide por PEDIDO. FactCompras tiene grano de línea, así que se cuenta con DISTINCTCOUNT(pedido_id)
  o se reduce el grano con SUMMARIZE antes de promediar.
- El stock es semiaditivo: es la suma ACUMULADA de movimientos hasta la última fecha visible, no la suma del periodo.
"""

EUR = "#,0.00 €"
ENT = "#,0"
PCT = "0.0 %"
DEC = "#,0.0"

MEDIDAS = [
    # ---------------- Compras ----------------
    ("FactCompras", "Compras", "Coste total de compras", EUR,
     "Importe pedido (cantidad × precio) de pedidos no cancelados ni en borrador.",
     """CALCULATE (
    SUM ( FactCompras[importe] ),
    NOT FactCompras[estado_pedido] IN { "borrador", "cancelado" }
)"""),
    ("FactCompras", "Compras", "Pedidos", ENT,
     "Número de pedidos distintos (no líneas).",
     """CALCULATE (
    DISTINCTCOUNT ( FactCompras[pedido_id] ),
    NOT FactCompras[estado_pedido] IN { "borrador", "cancelado" }
)"""),
    ("FactCompras", "Compras", "Importe medio por pedido", EUR, "Coste total dividido entre pedidos.",
     "DIVIDE ( [Coste total de compras], [Pedidos] )"),
    ("FactCompras", "Compras", "Precio medio de compra", "#,0.0000 €",
     "Precio medio ponderado por cantidad. Solo tiene sentido filtrado por producto.",
     """CALCULATE (
    DIVIDE ( SUM ( FactCompras[importe] ), SUM ( FactCompras[cantidad_pedida] ) ),
    NOT FactCompras[estado_pedido] IN { "borrador", "cancelado" }
)"""),
    ("FactCompras", "Compras", "Desviación sobre coste estándar %", PCT,
     "Cuánto se ha pagado por encima (+) o por debajo (−) del coste estándar, ponderado por cantidad comprada.",
     """VAR Real = [Coste total de compras]
VAR AEstandar =
    CALCULATE (
        SUMX ( FactCompras, FactCompras[cantidad_pedida] * RELATED ( DimProducto[coste_estandar] ) ),
        NOT FactCompras[estado_pedido] IN { "borrador", "cancelado" }
    )
RETURN
    DIVIDE ( Real - AEstandar, AEstandar )"""),

    # ---------------- Evolución temporal ----------------
    ("FactCompras", "Evolución", "Gasto mes anterior", EUR, "Coste total de compras del mes anterior al periodo visible.",
     "CALCULATE ( [Coste total de compras], DATEADD ( DimFecha[fecha], -1, MONTH ) )"),
    ("FactCompras", "Evolución", "Variación mensual del gasto %", PCT, "Cambio respecto al mes anterior.",
     """VAR Anterior = [Gasto mes anterior]
RETURN
    IF (
        NOT ISBLANK ( Anterior ) && NOT ISBLANK ( [Coste total de compras] ),
        DIVIDE ( [Coste total de compras] - Anterior, Anterior )
    )"""),
    ("FactCompras", "Evolución", "Gasto acumulado del año", EUR, "Acumulado desde el 1 de enero hasta el final del periodo visible.",
     "TOTALYTD ( [Coste total de compras], DimFecha[fecha] )"),
    ("FactCompras", "Evolución", "Gasto media móvil 3 meses", EUR, "Media mensual de los tres últimos meses terminados en el periodo visible.",
     """VAR Ventana = DATESINPERIOD ( DimFecha[fecha], MAX ( DimFecha[fecha] ), -3, MONTH )
RETURN
    IF (
        NOT ISBLANK ( [Coste total de compras] ),
        AVERAGEX (
            CALCULATETABLE ( VALUES ( DimFecha[anio_mes] ), Ventana ),
            CALCULATE ( [Coste total de compras], ALLEXCEPT ( DimFecha, DimFecha[anio_mes] ) )
        )
    )"""),

    # ---------------- Proveedores ----------------
    ("FactCompras", "Proveedores", "Pedidos completados", ENT, "Pedidos recibidos por completo.",
     "CALCULATE ( DISTINCTCOUNT ( FactCompras[pedido_id] ), FactCompras[pedido_completo] = TRUE () )"),
    ("FactCompras", "Proveedores", "Pedidos a tiempo", ENT, "Pedidos completos cuya última recepción llegó en la fecha prevista o antes.",
     """CALCULATE (
    DISTINCTCOUNT ( FactCompras[pedido_id] ),
    FactCompras[pedido_completo] = TRUE (),
    FactCompras[pedido_a_tiempo] = TRUE ()
)"""),
    ("FactCompras", "Proveedores", "% Entregas puntuales", PCT, "Pedidos a tiempo sobre pedidos completados.",
     "DIVIDE ( [Pedidos a tiempo], [Pedidos completados] )"),
    ("FactCompras", "Proveedores", "Retraso medio (días)", DEC,
     "Media de días de retraso por pedido completado (0 si llegó a tiempo). Se reduce a un pedido por fila antes de promediar.",
     """AVERAGEX (
    CALCULATETABLE (
        SUMMARIZE ( FactCompras, FactCompras[pedido_id], FactCompras[dias_retraso] ),
        FactCompras[pedido_completo] = TRUE ()
    ),
    FactCompras[dias_retraso]
)"""),
    ("FactCompras", "Proveedores", "Plazo real medio (días)", DEC, "Días entre el pedido y su última recepción, por pedido completado.",
     """AVERAGEX (
    CALCULATETABLE (
        SUMMARIZE ( FactCompras, FactCompras[pedido_id], FactCompras[plazo_real_dias] ),
        FactCompras[pedido_completo] = TRUE ()
    ),
    FactCompras[plazo_real_dias]
)"""),
    ("FactCompras", "Proveedores", "Desviación de plazo (días)", DEC, "Plazo real medio menos plazo acordado del proveedor.",
     """IF (
    HASONEVALUE ( DimProveedor[proveedor_key] ) && NOT ISBLANK ( [Plazo real medio (días)] ),
    [Plazo real medio (días)] - SELECTEDVALUE ( DimProveedor[plazo_acordado_dias] )
)"""),
    ("FactRecepciones", "Proveedores", "% Rechazo", "0.00 %", "Unidades rechazadas sobre el total entregado (aceptado + rechazado).",
     """DIVIDE (
    SUM ( FactRecepciones[cantidad_rechazada] ),
    SUM ( FactRecepciones[cantidad_recibida] ) + SUM ( FactRecepciones[cantidad_rechazada] )
)"""),
    ("FactRecepciones", "Proveedores", "Importe recibido", EUR, "Valor de la mercancía aceptada, a precio de compra.",
     "SUM ( FactRecepciones[importe_recibido] )"),
    ("FactCompras", "Proveedores", "Cuota de gasto %", PCT, "Peso del proveedor sobre el gasto total del periodo.",
     "DIVIDE ( [Coste total de compras], CALCULATE ( [Coste total de compras], REMOVEFILTERS ( DimProveedor ) ) )"),
    ("FactCompras", "Proveedores", "Ranking de proveedor por gasto", ENT, "Posición del proveedor por gasto en el periodo.",
     """IF (
    HASONEVALUE ( DimProveedor[proveedor_key] ) && NOT ISBLANK ( [Coste total de compras] ),
    -- ALLSELECTED sobre la TABLA: si solo se liberase la clave, el filtro de la columna visible (código o nombre)
    -- seguiría activo y todos los proveedores quedarían primeros.
    RANKX ( ALLSELECTED ( DimProveedor ), [Coste total de compras],, DESC, DENSE )
)"""),

    # ---------------- Inventario ----------------
    ("FactMovimientosInventario", "Inventario", "Stock", "#,0.###",
     "Existencias al cierre de la última fecha visible: suma acumulada de todos los movimientos hasta esa fecha.",
     """VAR UltimaFecha = MAX ( DimFecha[fecha] )
RETURN
    CALCULATE (
        SUM ( FactMovimientosInventario[cantidad] ),
        REMOVEFILTERS ( DimFecha ),
        DimFecha[fecha] <= UltimaFecha
    )"""),
    ("FactMovimientosInventario", "Inventario", "Valor del inventario", EUR,
     "Stock de cada producto valorado a su coste estándar. Semiaditivo: no se suma entre fechas.",
     "SUMX ( DimProducto, [Stock] * DimProducto[coste_estandar] )"),
    ("FactMovimientosInventario", "Inventario", "Productos bajo mínimo", ENT,
     "Productos activos cuyo stock total está por debajo de su stock mínimo.",
     """COUNTROWS (
    FILTER ( DimProducto, DimProducto[activo] = TRUE () && [Stock] < DimProducto[stock_minimo] )
)"""),
    ("FactMovimientosInventario", "Inventario", "Entradas (unidades)", ENT, "Unidades que han entrado en el periodo.",
     "SUM ( FactMovimientosInventario[cantidad_entrada] )"),
    ("FactMovimientosInventario", "Consumo", "Consumo (unidades)", ENT, "Unidades salidas por consumo en el periodo.",
     """CALCULATE (
    SUM ( FactMovimientosInventario[cantidad_salida] ),
    FactMovimientosInventario[tipo_movimiento] = "SALIDA_CONSUMO"
)"""),
    ("FactMovimientosInventario", "Consumo", "Consumo valorado", EUR,
     "Coste de lo consumido en el periodo. Con la dimensión de producto da el consumo por categoría.",
     """CALCULATE (
    - SUM ( FactMovimientosInventario[importe] ),
    FactMovimientosInventario[tipo_movimiento] = "SALIDA_CONSUMO"
)"""),
    ("FactMovimientosInventario", "Consumo", "Cuota de consumo por categoría %", PCT, "Peso de la selección sobre el consumo valorado total.",
     "DIVIDE ( [Consumo valorado], CALCULATE ( [Consumo valorado], REMOVEFILTERS ( DimProducto ) ) )"),
    ("FactMovimientosInventario", "Inventario", "Días del periodo", ENT, "Días entre el primer y el último movimiento del periodo visible.",
     """VAR Primera = CALCULATE ( MIN ( DimFecha[fecha] ), FactMovimientosInventario )
VAR Ultima = CALCULATE ( MAX ( DimFecha[fecha] ), FactMovimientosInventario )
RETURN
    IF ( NOT ISBLANK ( Primera ), DATEDIFF ( Primera, Ultima, DAY ) + 1 )"""),
    ("FactMovimientosInventario", "Inventario", "Rotación de inventario", "#,0.0 x",
     "Veces al año que se renueva el inventario: consumo valorado anualizado entre el valor del inventario al cierre.",
     "DIVIDE ( DIVIDE ( [Consumo valorado] * 365, [Días del periodo] ), [Valor del inventario] )"),
    ("FactMovimientosInventario", "Inventario", "Consumo medio diario (90 días)", DEC,
     "Unidades consumidas al día en los 90 días anteriores al último movimiento visible.",
     """VAR Ultima = CALCULATE ( MAX ( DimFecha[fecha] ), FactMovimientosInventario )
RETURN
    DIVIDE (
        CALCULATE ( [Consumo (unidades)], DATESINPERIOD ( DimFecha[fecha], Ultima, -90, DAY ) ),
        90
    )"""),
    ("FactMovimientosInventario", "Inventario", "Días de cobertura", DEC,
     "Cuántos días dura el stock actual al ritmo de consumo de los últimos 90 días.",
     "DIVIDE ( [Stock], [Consumo medio diario (90 días)] )"),
]
