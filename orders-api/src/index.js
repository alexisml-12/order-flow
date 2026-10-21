const { loadConfig } = require('./config');
const { initDatabase } = require('./db');
const { createOrdersRepository } = require('./ordersRepository');
const { createMessaging } = require('./messaging');
const { handleStockResult } = require('./handleStockResult');
const { startOutboxRelay } = require('./outboxRelay');
const { createApp } = require('./app');

async function main() {
  const config = loadConfig(); // lee las variables de entorno
  const pool = await initDatabase(config.db); // crea la base de datos y las tablas si no existen, y devuelve un pool de conexiones
  const repo = createOrdersRepository(pool); // crea el repositorio de pedidos, que es la única capa que conoce SQL Server
  const messaging = await createMessaging(config.rabbitUrl); // crea la conexión con RabbitMQ y devuelve un objeto para publicar y consumir eventos

  // Escucha los resultados que publica Inventory y actualiza el estado de los pedidos.
  await messaging.consumeStockResults(async (event) => { // deja registrado un consumidor sobre la cola orders.stock-result
    const result = await handleStockResult(event, { repo });
    if (result.aplicado) {
      console.log(`Pedido ${event.orderId}: ahora está ${result.estado}`);
    } else {
      console.log(`Pedido ${event.orderId}: resultado ignorado (${result.motivo})`);
    }
  });

  // Republica los eventos que no pudieron llegar al broker (por ejemplo, si estaba caído).
  const relay = startOutboxRelay({ // arranca el relay, que revisa cada 10 segundos si hay eventos sin publicar
    repo,
    publisher: messaging,
    intervalMs: config.outboxIntervalMs,
  });

  const app = createApp({ repo, publisher: messaging, corsOrigin: config.corsOrigin });
  const server = app.listen(config.port, () => {
    console.log(`Orders API escuchando en el puerto ${config.port}`);
  });

  // Cierre ordenado: Docker envía SIGTERM al detener el contenedor.
  const shutdown = async () => {
    relay.stop();
    server.close();
    await messaging.close();
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
