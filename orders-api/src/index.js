const { loadConfig } = require('./config');
const { initDatabase } = require('./db');
const { createOrdersRepository } = require('./ordersRepository');
const { createPublisher } = require('./messaging');
const { createApp } = require('./app');

async function main() {
  const config = loadConfig();
  const pool = await initDatabase(config.db); // Conexión a SQL Server
  const publisher = await createPublisher(config.rabbitUrl); // Conexión a RabbitMQ
  const app = createApp({
    repo: createOrdersRepository(pool),
    publisher,
    corsOrigin: config.corsOrigin,
  });

  const server = app.listen(config.port, () => {
    console.log(`Orders API escuchando en el puerto ${config.port}`);
  });

  // Cierre ordenado: Docker envía SIGTERM al detener el contenedor.
  const shutdown = async () => {
    server.close();
    await publisher.close().catch(() => {});
    await pool.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('No se pudo iniciar Orders API:', err);
  process.exit(1);
});
