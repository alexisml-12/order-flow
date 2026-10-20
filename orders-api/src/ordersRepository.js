const crypto = require('node:crypto');
const sql = require('mssql');

// SQL Server devuelve los GUID en mayúsculas; los normalizamos a minúsculas.
function mapOrder(row) {
  return { ...row, id: row.id.toLowerCase() };
}

const SELECT_COLUMNS = 'id, clienteNombre, sku, cantidad, estado, creadoEn';

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
                 inserted.cantidad, inserted.estado, inserted.creadoEn
          VALUES (@id, @clienteNombre, @sku, @cantidad)
        `);
      return mapOrder(result.recordset[0]);
    },

    async list() {
      const result = await pool
        .request()
        .query(`SELECT ${SELECT_COLUMNS} FROM dbo.Orders ORDER BY creadoEn DESC`);
      return result.recordset.map(mapOrder);
    },

    async getById(id) {
      const result = await pool
        .request()
        .input('id', sql.UniqueIdentifier, id)
        .query(`SELECT ${SELECT_COLUMNS} FROM dbo.Orders WHERE id = @id`);
      return result.recordset[0] ? mapOrder(result.recordset[0]) : null;
    },
  };
}

module.exports = { createOrdersRepository };
