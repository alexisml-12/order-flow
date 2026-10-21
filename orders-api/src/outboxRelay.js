// Relay de eventos pendientes (versión simple del "outbox pattern").
//
// Problema: guardar el pedido en la base y publicar el evento en RabbitMQ son dos operaciones
// en sistemas distintos, y no pueden hacerse en una sola transacción. Si el broker está caído
// justo al publicar, el pedido quedaría guardado pero sin evento, y nadie lo procesaría nunca.
//
// Solución: cada pedido guarda si su evento ya se publicó (publicadoEn). Este proceso revisa
// periódicamente los que siguen sin publicar y los vuelve a intentar hasta que RabbitMQ responda.

function startOutboxRelay({ repo, publisher, intervalMs = 10000, batchSize = 20 }) {
  let running = false;

  async function tick() {
    if (running) return; // evita que dos revisiones se pisen entre sí
    running = true;
    try {
      const pending = await repo.listUnpublished(batchSize);
      for (const order of pending) {
        await publisher.publishOrderCreated(order);
        await repo.markPublished(order.id);
        console.log(`Relay: evento OrderCreated del pedido ${order.id} publicado`);
      }
    } catch (err) {
      // Normal mientras el broker o la base estén caídos: se reintenta en la próxima vuelta.
      console.warn(`Relay: no se pudo publicar eventos pendientes (${err.message})`);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, intervalMs);

  return {
    stop() {
      clearInterval(timer);
    },
  };
}

module.exports = { startOutboxRelay };
