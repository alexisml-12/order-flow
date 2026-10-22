const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sql = require('mssql');
const { createInventoryRepository } = require('../src/inventoryRepository');

// Si existe el archivo .env de la raíz, se usa para leer las credenciales (no pisa variables ya definidas).
// process.loadEnvFile solo existe en Node recientes; si no está, se usan los valores por defecto.
try {
  process.loadEnvFile(require('node:path').join(__dirname, '..', '..', '.env'));
} catch {
  // sin .env: se usan los valores por defecto de abajo
}

// Test 5 - Prueba de integración REAL de la idempotencia, contra SQL Server.
// Necesita el sistema levantado (docker compose up -d). Si SQL Server no está disponible,
// el test se omite (skip) en lugar de fallar.
const config = {
  server: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || process.env.MSSQL_SA_PASSWORD || 'OrderFlow_Demo_2026',
  database: process.env.DB_NAME || 'OrderFlowDb',
  connectionTimeout: 3000,
  options: { encrypt: false, trustServerCertificate: true },
};

const TEST_SKU = 'TEST-IDEMP';

test('idempotencia (integración): el mismo evento procesado dos veces descuenta el stock una sola vez', async (t) => {
  const pool = new sql.ConnectionPool(config);
  try {
    await pool.connect();
    await pool.request().query('SELECT TOP 1 1 AS ok FROM dbo.ProcessedEvents');
  } catch (err) {
    await pool.close().catch(() => {});
    t.skip(`SQL Server no disponible (${err.message}). Levanta el sistema con "docker compose up -d" para ejecutar este test`);
    return;
  }

  const eventId = crypto.randomUUID();
  const orderId = crypto.randomUUID();

  try {
    await pool.request().query(`
      DELETE FROM dbo.Products WHERE sku = '${TEST_SKU}';
      INSERT INTO dbo.Products (sku, nombre, stock) VALUES ('${TEST_SKU}', N'Producto de prueba', 10);
    `);

    const repo = createInventoryRepository(pool);
    const event = { eventId, orderId, sku: TEST_SKU, cantidad: 3 };

    const first = await repo.reserveStock(event);
    const second = await repo.reserveStock(event); // el mismo evento, otra vez

    const { recordset } = await pool.request().query(`SELECT stock FROM dbo.Products WHERE sku = '${TEST_SKU}'`);

    assert.equal(first.duplicado, false);
    assert.equal(second.duplicado, true);
    assert.equal(second.resultado, 'StockReserved');
    assert.equal(recordset[0].stock, 7); // 10 - 3, descontado una sola vez
  } finally {
    await pool.request().query(`
      DELETE FROM dbo.ProcessedEvents WHERE eventId = '${eventId}';
      DELETE FROM dbo.Products WHERE sku = '${TEST_SKU}';
    `);
    await pool.close();
  }
});
