const crypto = require('node:crypto');
const sql = require('mssql');

// SQL Server devuelve los GUID en mayúsculas; los normalizamos a minúsculas.
function mapOrder(row) {
  const order = { ...row, id: row.id.toLowerCase() };
  if (order.eventId) order.eventId = order.eventId.toLowerCase();
  return order;
}

// Columnas que la API expone públicamente (eventId y publicadoEn son detalles internos).
const PUBLIC_COLUMNS = 'id, clienteNombre, sku, cantidad, estado, creadoEn';

// El repositorio es la única capa que conoce SQL. Si mañana cambia la base de datos,
// solo cambia este archivo.
function createOrdersRepository(pool) {
  return {
    async skuExists(sku) {
      const result = await pool
        .request()
        .input('sku', sql.NVarChar(50), sku)
        .query('SELECT 1 AS existe FROM dbo.Products WHERE sku = @sku');
      return result.recordset.length > 0;
    },

    // Devuelve el pedido creado, incluido su eventId (necesario para publicar el evento).
    async create({ clienteNombre, sku, cantidad }) {
      const result = await pool
        .request()
        .input('id', sql.UniqueIdentifier, crypto.randomUUID())
        .input('clienteNombre', sql.NVarChar(200), clienteNombre)
        .input('sku', sql.NVarChar(50), sku)
        .input('cantidad', sql.Int, cantidad)
        .query(`
          INSERT INTO dbo.Orders (id, clienteNombre, sku, cantidad)
          OUTPUT inserted.id, inserted.clienteNombre, inserted.sku,
                 inserted.cantidad, inserted.estado, inserted.creadoEn, inserted.eventId
          VALUES (@id, @clienteNombre, @sku, @cantidad)
        `);
      return mapOrder(result.recordset[0]);
    },

    async list() {
      const result = await pool
        .request()
        .query(`SELECT ${PUBLIC_COLUMNS} FROM dbo.Orders ORDER BY creadoEn DESC`);
      return result.recordset.map(mapOrder);
    },

    async getById(id) {
      const result = await pool
        .request()
        .input('id', sql.UniqueIdentifier, id)
        .query(`SELECT ${PUBLIC_COLUMNS} FROM dbo.Orders WHERE id = @id`);
      return result.recordset[0] ? mapOrder(result.recordset[0]) : null;
    },

    // Cambia el estado SOLO si el pedido sigue en Pending. Es atómico: aunque lleguen dos
    // resultados a la vez, solo uno logra el cambio. Devuelve true si cambió el estado.
    async updateStatus(id, newStatus) {
      const result = await pool
        .request()
        .input('id', sql.UniqueIdentifier, id)
        .input('estado', sql.NVarChar(20), newStatus)
        .query("UPDATE dbo.Orders SET estado = @estado WHERE id = @id AND estado = 'Pending'");
      return result.rowsAffected[0] === 1;
    },

    // Pedidos cuyo evento OrderCreated todavía no se pudo publicar en RabbitMQ.
    // Se ignoran los muy recientes para no competir con la publicación inmediata de la ruta POST.
    async listUnpublished(limit, graceSeconds = 5) {
      const result = await pool
        .request()
        .input('limit', sql.Int, limit)
        .input('grace', sql.Int, graceSeconds)
        .query(`
          SELECT TOP (@limit) ${PUBLIC_COLUMNS}, eventId
          FROM dbo.Orders
          WHERE publicadoEn IS NULL
            AND creadoEn < DATEADD(SECOND, -@grace, SYSUTCDATETIME())
          ORDER BY creadoEn
        `);
      return result.recordset.map(mapOrder);
    },

    async markPublished(id) {
      await pool
        .request()
        .input('id', sql.UniqueIdentifier, id)
        .query('UPDATE dbo.Orders SET publicadoEn = SYSUTCDATETIME() WHERE id = @id AND publicadoEn IS NULL');
    },
  };
}

module.exports = { createOrdersRepository };
