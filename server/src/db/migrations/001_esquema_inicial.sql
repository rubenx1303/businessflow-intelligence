-- Esquema operativo (OLTP). Todas las tablas de negocio llevan empresa_id:
-- hoy hay una sola empresa, pero el modelo ya admite multiempresa sin migraciones destructivas.

CREATE TABLE empresas (
  id          SERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL,
  cif         TEXT NOT NULL UNIQUE,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
  id            SERIAL PRIMARY KEY,
  empresa_id    INT NOT NULL REFERENCES empresas(id),
  email         TEXT NOT NULL UNIQUE,
  nombre        TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rol           TEXT NOT NULL CHECK (rol IN ('admin','compras','almacen','lectura')),
  activo        BOOLEAN NOT NULL DEFAULT true,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE proveedores (
  id                  SERIAL PRIMARY KEY,
  empresa_id          INT NOT NULL REFERENCES empresas(id),
  codigo              TEXT NOT NULL,
  nombre              TEXT NOT NULL,
  cif                 TEXT NOT NULL,
  email               TEXT,
  telefono            TEXT,
  ciudad              TEXT,
  pais                TEXT NOT NULL DEFAULT 'España',
  plazo_entrega_dias  INT NOT NULL DEFAULT 7 CHECK (plazo_entrega_dias BETWEEN 0 AND 365),
  condiciones_pago    TEXT NOT NULL DEFAULT '30 días',
  estado              TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','en_revision','bloqueado','inactivo')),
  notas               TEXT,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, codigo)
);

CREATE TABLE almacenes (
  id          SERIAL PRIMARY KEY,
  empresa_id  INT NOT NULL REFERENCES empresas(id),
  codigo      TEXT NOT NULL,
  nombre      TEXT NOT NULL,
  ciudad      TEXT,
  activo      BOOLEAN NOT NULL DEFAULT true,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, codigo)
);

CREATE TABLE productos (
  id                       SERIAL PRIMARY KEY,
  empresa_id               INT NOT NULL REFERENCES empresas(id),
  sku                      TEXT NOT NULL,
  nombre                   TEXT NOT NULL,
  categoria                TEXT NOT NULL,
  unidad                   TEXT NOT NULL DEFAULT 'ud',
  coste_estandar           NUMERIC(12,4) NOT NULL CHECK (coste_estandar >= 0),
  stock_minimo             NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  lote_compra              NUMERIC(14,3) NOT NULL DEFAULT 1 CHECK (lote_compra > 0),
  proveedor_preferente_id  INT REFERENCES proveedores(id),
  activo                   BOOLEAN NOT NULL DEFAULT true,
  creado_en                TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, sku)
);

CREATE TABLE pedidos_compra (
  id                      SERIAL PRIMARY KEY,
  empresa_id              INT NOT NULL REFERENCES empresas(id),
  numero                  TEXT NOT NULL,
  proveedor_id            INT NOT NULL REFERENCES proveedores(id),
  almacen_id              INT NOT NULL REFERENCES almacenes(id),
  estado                  TEXT NOT NULL DEFAULT 'borrador'
                          CHECK (estado IN ('borrador','enviado','parcial','recibido','cancelado')),
  fecha_pedido            DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_entrega_prevista  DATE NOT NULL,
  notas                   TEXT,
  creado_por              INT REFERENCES usuarios(id),
  creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero),
  CHECK (fecha_entrega_prevista >= fecha_pedido)
);

CREATE TABLE lineas_pedido (
  id               SERIAL PRIMARY KEY,
  pedido_id        INT NOT NULL REFERENCES pedidos_compra(id) ON DELETE CASCADE,
  producto_id      INT NOT NULL REFERENCES productos(id),
  cantidad         NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario  NUMERIC(12,4) NOT NULL CHECK (precio_unitario >= 0),
  UNIQUE (pedido_id, producto_id)
);

CREATE TABLE recepciones (
  id               SERIAL PRIMARY KEY,
  empresa_id       INT NOT NULL REFERENCES empresas(id),
  pedido_id        INT NOT NULL REFERENCES pedidos_compra(id),
  albaran          TEXT NOT NULL,
  fecha_recepcion  DATE NOT NULL DEFAULT CURRENT_DATE,
  notas            TEXT,
  creado_por       INT REFERENCES usuarios(id),
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE lineas_recepcion (
  id                  SERIAL PRIMARY KEY,
  recepcion_id        INT NOT NULL REFERENCES recepciones(id) ON DELETE CASCADE,
  linea_pedido_id     INT NOT NULL REFERENCES lineas_pedido(id),
  cantidad_recibida   NUMERIC(14,3) NOT NULL CHECK (cantidad_recibida >= 0),
  cantidad_rechazada  NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (cantidad_rechazada >= 0),
  CHECK (cantidad_recibida + cantidad_rechazada > 0)
);

-- Libro de movimientos: única fuente de verdad del stock. La cantidad lleva signo
-- (entradas > 0, salidas < 0). Nunca se actualiza ni se borra: se corrige con un AJUSTE.
CREATE TABLE movimientos_stock (
  id             BIGSERIAL PRIMARY KEY,
  empresa_id     INT NOT NULL REFERENCES empresas(id),
  producto_id    INT NOT NULL REFERENCES productos(id),
  almacen_id     INT NOT NULL REFERENCES almacenes(id),
  tipo           TEXT NOT NULL CHECK (tipo IN ('ENTRADA_COMPRA','SALIDA_CONSUMO','AJUSTE','INICIAL')),
  cantidad       NUMERIC(14,3) NOT NULL CHECK (cantidad <> 0),
  coste_unitario NUMERIC(12,4) NOT NULL CHECK (coste_unitario >= 0),
  referencia     TEXT,
  recepcion_id   INT REFERENCES recepciones(id),
  fecha          TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por     INT REFERENCES usuarios(id),
  CHECK ((tipo = 'ENTRADA_COMPRA' AND cantidad > 0) OR (tipo = 'SALIDA_CONSUMO' AND cantidad < 0) OR tipo IN ('AJUSTE','INICIAL'))
);

CREATE TABLE auditoria (
  id          BIGSERIAL PRIMARY KEY,
  empresa_id  INT NOT NULL REFERENCES empresas(id),
  usuario_id  INT REFERENCES usuarios(id),
  accion      TEXT NOT NULL,
  entidad     TEXT NOT NULL,
  entidad_id  TEXT,
  detalle     JSONB,
  fecha       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mov_producto_almacen ON movimientos_stock (empresa_id, producto_id, almacen_id);
CREATE INDEX idx_mov_fecha            ON movimientos_stock (empresa_id, fecha);
CREATE INDEX idx_pedidos_proveedor    ON pedidos_compra (empresa_id, proveedor_id, fecha_pedido);
CREATE INDEX idx_lineas_pedido        ON lineas_pedido (pedido_id);
CREATE INDEX idx_recepciones_pedido   ON recepciones (pedido_id);
CREATE INDEX idx_lineas_recepcion     ON lineas_recepcion (linea_pedido_id);
CREATE INDEX idx_auditoria_fecha      ON auditoria (empresa_id, fecha DESC);

-- Existencias por producto y almacén, derivadas del libro de movimientos.
CREATE VIEW v_existencias AS
SELECT m.empresa_id, m.producto_id, m.almacen_id, SUM(m.cantidad) AS stock
FROM movimientos_stock m
GROUP BY m.empresa_id, m.producto_id, m.almacen_id;

-- Estado de cada línea de pedido: pedido, recibido, rechazado y pendiente.
CREATE VIEW v_lineas_pedido_estado AS
SELECT lp.id AS linea_pedido_id, lp.pedido_id, lp.producto_id, lp.cantidad, lp.precio_unitario,
       COALESCE(SUM(lr.cantidad_recibida), 0)  AS recibido,
       COALESCE(SUM(lr.cantidad_rechazada), 0) AS rechazado,
       GREATEST(lp.cantidad - COALESCE(SUM(lr.cantidad_recibida), 0), 0) AS pendiente
FROM lineas_pedido lp
LEFT JOIN lineas_recepcion lr ON lr.linea_pedido_id = lp.id
GROUP BY lp.id;
