const crypto = require('node:crypto');
const amqp = require('amqplib');

// Topología de RabbitMQ. Orders API declara lo mismo para la cola de OrderCreated.
const EXCHANGE = 'orderflow';
const ROUTING_KEYS = {
  orderCreated: 'order.created',
  stockReserved: 'stock.reserved',
  stockRejected: 'stock.rejected',
};
const QUEUES = {
  orderCreated: 'inventory.order-created',
  stockResult: 'orders.stock-result',
};

const RETRY_DELAY_MS = 2000;
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

async function createMessaging(url, { onConnectionLost } = {}) {
  let closing = false;
  const connection = await connectWithRetry(url);
  connection.on('error', (err) => console.error('Error en la conexión con RabbitMQ:', err.message));
  connection.on('close', () => {
    if (!closing) onConnectionLost?.();
  });

  const channel = await connection.createConfirmChannel();
  await channel.assertExchange(EXCHANGE, 'direct', { durable: true });

  await channel.assertQueue(QUEUES.orderCreated, { durable: true }); // Declaramos la cola de eventos OrderCreated (si no existía, se crea; si ya existía, no hace nada).
  await channel.bindQueue(QUEUES.orderCreated, EXCHANGE, ROUTING_KEYS.orderCreated);// aqui se especifica la regla "los mensajes con etiqueta order.created del exchange orderflow van a esta cola"

  // Cola donde Orders API (etapa 4) leerá los resultados. Recibe tanto reservas como rechazos.
  await channel.assertQueue(QUEUES.stockResult, { durable: true }); // Declaramos la cola de resultados de stock (si no existía, se crea; si ya existía, no hace nada).
  await channel.bindQueue(QUEUES.stockResult, EXCHANGE, ROUTING_KEYS.stockReserved); // aqui se especifica la regla "los mensajes con etiqueta stock.reserved del exchange orderflow van a esta cola"
  await channel.bindQueue(QUEUES.stockResult, EXCHANGE, ROUTING_KEYS.stockRejected); // aqui se especifica la regla "los mensajes con etiqueta stock.rejected del exchange orderflow van a esta cola"

  return {
    async publishStockResult(resultado, orderEvent) {
      const event = {
        eventId: crypto.randomUUID(),
        tipo: resultado, // 'StockReserved' | 'StockRejected'
        orderId: orderEvent.orderId,
        sku: orderEvent.sku,
        cantidad: orderEvent.cantidad,
        ocurridoEn: new Date().toISOString(),
      };
      const routingKey =
        resultado === 'StockReserved' ? ROUTING_KEYS.stockReserved : ROUTING_KEYS.stockRejected;

      channel.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify(event)), { // aqui se publica el mensaje en el exchange orderflow con la etiqueta stock.reserved o stock.rejected, y el contenido es el JSON del evento
        persistent: true,
        contentType: 'application/json',
        messageId: event.eventId,
      });
      await channel.waitForConfirms();
    },

    // Política de ack:
    //  - éxito                      -> ack (se borra de la cola)
    //  - JSON inválido o permanente -> nack sin reencolar (se descarta)
    //  - error transitorio          -> espera y nack con reencolar (se reintenta)
    async consumeOrderCreated(handler) {
      await channel.prefetch(1); // procesa un mensaje a la vez
      await channel.consume(QUEUES.orderCreated, async (msg) => { // aqui se especifica que se van a leer los mensajes de la cola de OrderCreated
        if (!msg) return; // el consumidor fue cancelado por el broker

        let event;
        try {
          event = JSON.parse(msg.content.toString());
        } catch {
          console.error('Mensaje que no es JSON válido; se descarta');
          channel.nack(msg, false, false);
          return;
        }

        try {
          await handler(event); // Ejecuta la logica de la funcion flecha del index.js del worker, que llama a handleOrderCreated y publica el resultado
          channel.ack(msg); // Si no hubo error, confirma el mensaje (se borra de la cola)
        } catch (err) {
          if (err.permanent) {
            console.error(`Mensaje inválido; se descarta: ${err.message}`);
            channel.nack(msg, false, false);
          } else {
            console.error(`Error procesando el evento ${event.eventId}; se reintentará:`, err.message);
            await sleep(RETRY_DELAY_MS); // evita un bucle de reintentos instantáneos
            channel.nack(msg, false, true);
          }
        }
      });
    },

    async close() {
      closing = true;
      await channel.close();
      await connection.close();
    },
  };
}

module.exports = { createMessaging };
