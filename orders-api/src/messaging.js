const crypto = require('node:crypto');
const amqp = require('amqplib');

// Topología de RabbitMQ. Ambos servicios declaran lo mismo (con idénticos parámetros),
// así no importa cuál arranque primero.
const EXCHANGE = 'orderflow';
const ROUTING_KEY_ORDER_CREATED = 'order.created';
const QUEUE_ORDER_CREATED = 'inventory.order-created';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectWithRetry(url, { retries = 30, delayMs = 2000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await amqp.connect(url);
    } catch (err) {
      if (attempt >= retries) throw err;
      console.log(`RabbitMQ no está listo (intento ${attempt}/${retries}). Reintentando...`);
      await sleep(delayMs);
    }
  }
}

async function createPublisher(url) {
  const connection = await connectWithRetry(url);
  connection.on('error', (err) => console.error('Error en la conexión con RabbitMQ:', err.message));
  connection.on('close', () => console.warn('La conexión con RabbitMQ se cerró'));

  // "Confirm channel": RabbitMQ confirma que recibió y guardó cada mensaje publicado.
  const channel = await connection.createConfirmChannel();
  await channel.assertExchange(EXCHANGE, 'direct', { durable: true });// Declaramos el exchange (si no existía, se crea; si ya existía, no hace nada).

  // Declaramos y enlazamos también la cola de destino. Si no existiera ninguna cola enlazada,
  // RabbitMQ descartaría el mensaje en silencio.
  await channel.assertQueue(QUEUE_ORDER_CREATED, { durable: true });
  await channel.bindQueue(QUEUE_ORDER_CREATED, EXCHANGE, ROUTING_KEY_ORDER_CREATED);

  return {
    async publishOrderCreated(order) {
      const event = {
        eventId: crypto.randomUUID(),
        orderId: order.id,
        sku: order.sku,
        cantidad: order.cantidad,
        ocurridoEn: new Date().toISOString(),
      };
      channel.publish(EXCHANGE, ROUTING_KEY_ORDER_CREATED, Buffer.from(JSON.stringify(event)), {
        persistent: true, // el mensaje se guarda en disco
        contentType: 'application/json',
        messageId: event.eventId,
      });
      await channel.waitForConfirms();
      return event;
    },

    async close() {
      await channel.close();
      await connection.close();
    },
  };
}

module.exports = { createPublisher };
