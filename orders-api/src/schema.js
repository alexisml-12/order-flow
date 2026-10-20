// Esquema y seed de la base de datos compartida. Es idempotente: se puede ejecutar en cada arranque.

const schemaSql = `
IF OBJECT_ID('dbo.Products', 'U') IS NULL
  CREATE TABLE dbo.Products (
    sku    NVARCHAR(50)  NOT NULL PRIMARY KEY,
    nombre NVARCHAR(200) NOT NULL,
    stock  INT           NOT NULL CHECK (stock >= 0)
  );

IF OBJECT_ID('dbo.Orders', 'U') IS NULL
  CREATE TABLE dbo.Orders (
    id            UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    clienteNombre NVARCHAR(200)    NOT NULL,
    sku           NVARCHAR(50)     NOT NULL REFERENCES dbo.Products(sku),
    cantidad      INT              NOT NULL CHECK (cantidad BETWEEN 1 AND 100),
    estado        NVARCHAR(20)     NOT NULL
                  CONSTRAINT DF_Orders_estado DEFAULT 'Pending'
                  CHECK (estado IN ('Pending', 'Confirmed', 'Rejected')),
    creadoEn      DATETIME2        NOT NULL
                  CONSTRAINT DF_Orders_creadoEn DEFAULT SYSUTCDATETIME()
  );

MERGE dbo.Products AS target
USING (VALUES
  ('ABC-01', N'Camiseta básica', 100),
  ('ABC-02', N'Taza de cerámica', 100),
  ('ABC-03', N'Cuaderno A5', 100)
) AS source (sku, nombre, stock)
ON target.sku = source.sku
WHEN NOT MATCHED THEN
  INSERT (sku, nombre, stock) VALUES (source.sku, source.nombre, source.stock);
`;

module.exports = { schemaSql };
