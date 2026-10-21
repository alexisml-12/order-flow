const sql = require('mssql');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectWithRetry(config, { retries = 30, delayMs = 2000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const pool = new sql.ConnectionPool(config);
      await pool.connect();
      return pool;
    } catch (err) {
      if (attempt >= retries) throw err;
      console.log(`Base de datos no disponible (intento ${attempt}/${retries}). Reintentando...`);
      await sleep(delayMs);
    }
  }
}

// El esquema lo crea Orders API al arrancar. El worker no lo crea: espera a que exista.
async function waitForSchema(pool, { retries = 30, delayMs = 2000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    const result = await pool.request().query(`
      SELECT OBJECT_ID('dbo.Products', 'U')        AS products,
             OBJECT_ID('dbo.ProcessedEvents', 'U') AS processedEvents
    `);
    const row = result.recordset[0];
    if (row.products && row.processedEvents) return;
    if (attempt >= retries) throw new Error('Las tablas esperadas no existen. ¿Está corriendo Orders API?');
    console.log(`Esperando a que Orders API cree las tablas (intento ${attempt}/${retries})...`);
    await sleep(delayMs);
  }
}

async function connectDatabase(dbConfig) {
  const pool = await connectWithRetry(dbConfig);
  await waitForSchema(pool);
  return pool;
}

module.exports = { connectDatabase };
