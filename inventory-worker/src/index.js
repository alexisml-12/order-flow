const { loadConfig } = require('./config');
const { connectDatabase } = require('./db');
const { createInventoryRepository } = require('./inventoryRepository');
const { createMessaging } = require('./messaging');
const { handleOrderCreated } = require('./handleOrderCreated');

async function main() {
  const config = loadConfig();
  const pool = await connectDatabase(config.db);
  const messaging = await createMessaging(config.rabbitUrl);
  const repo = createInventoryRepository(pool);

  await messaging.consumeOrderCreated(async (event) => {
    const { resultado, duplicado } = await handleOrderCreated(event, { repo, publisher: messaging });
    const nota = duplicado ? ' (evento duplicado: no se descontó stock de nuevo)' : '';
    console.log(`Pedido ${event.orderId}: ${resultado}${nota} [eventId ${event.eventId}]`);
  });

  console.log('Inventory Worker esperando eventos OrderCreated...');

  const shutdown = async () => {
    await messaging.close().catch(() => {});
    await pool.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('No se pudo iniciar Inventory Worker:', err);
  process.exit(1);
});
