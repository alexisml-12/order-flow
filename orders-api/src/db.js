const sql = require('mssql');
const { schemaSql } = require('./schema');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// SQL Server tarda en arrancar dentro de Docker, así que reintentamos la conexión
// en lugar de fallar a la primera.
async function connectWithRetry(config, { retries = 30, delayMs = 2000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const pool = new sql.ConnectionPool(config);
      await pool.connect();
      return pool;
    } catch (err) {
      if (attempt >= retries) throw err;
      console.log(`SQL Server no está listo (intento ${attempt}/${retries}). Reintentando...`);
      await sleep(delayMs);
    }
  }
}

async function initDatabase(dbConfig) {
  const { database, ...baseConfig } = dbConfig;

  // 1) Conectar a "master" para crear la base de datos si no existe.
  const master = await connectWithRetry({ ...baseConfig, database: 'master' });
  try {
    await master
      .request()
      .input('name', sql.NVarChar, database)
      .query(`
        IF DB_ID(@name) IS NULL
        BEGIN
          DECLARE @stmt NVARCHAR(MAX) = N'CREATE DATABASE ' + QUOTENAME(@name);
          EXEC(@stmt);
        END
      `);
  } finally {
    await master.close();
  }

  // 2) Conectar a la base real, crear tablas y cargar el seed.
  const pool = await connectWithRetry({ ...baseConfig, database });
  await pool.request().query(schemaSql);
  return pool;
}

module.exports = { initDatabase };
