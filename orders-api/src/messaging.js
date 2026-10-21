const amqp = require('amqplib');

// Topología de RabbitMQ. Ambos servicios declaran lo mismo (con idénticos parámetros),
// así no importa cuál arranque primero.
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

const RECONNECT_DELAY_MS = 2000;
const PUBLISH_TIMEOUT_MS = 5000;
const CONSUMER_RETRY_DELAY_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Si RabbitMQ no confirma a tiempo, preferimos fallar (y reintentar luego) que quedarnos colgados.
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function declareTopology(channel) {
  await channel.assertExchange(EXCHANGE, 'direct', { durable: true });

  await channel.assertQueue(QUEUES.orderCreated, { durable: true });
  await channel.bindQueue(QUEUES.orderCreated, EXCHANGE, ROUTING_KEYS.orderCreated);

  await channel.assertQueue(QUEUES.stockResult, { durable: true });
  await channel.bindQueue(QUEUES.stockResult, EXCHANGE, ROUTING_KEYS.stockReserved);
  await channel.bindQueue(QUEUES.stockResult, EXCHANGE, ROUTING_KEYS.stockRejected);
}

// Si el canal ya se cerró, el ack/nack falla. No es grave: RabbitMQ reentregará el mensaje.
function settle(action) {
  try {
    action();
  } catch {
    console.warn('No se pudo confirmar el mensaje (canal cerrado); RabbitMQ lo reentregará');
  }
}

async function createMessaging(url, { initialRetries = 30 } = {}) {
  let connection = null;
  let channel = null; // null mientras no hay conexión con el broker
  let closing = false;
  let reconnecting = false;
  let stockResultHandler = null;

  async function startConsuming(ch) { // deja registrado un consumidor sobre la cola orders.stock-result, que llama a stockResultHandler
    await ch.prefetch(1);
    await ch.consume(QUEUES.stockResult, async (msg) => {
      if (!msg) return; // el consumidor fue cancelado por el broker

      let event;
      try {
        event = JSON.parse(msg.content.toString());
      } catch {
        console.error('Resultado de stock que no es JSON válido; se descarta');
        settle(() => ch.nack(msg, false, false));
        return;
      }

      try {
        await stockResultHandler(event);
        settle(() => ch.ack(msg));
      } catch (err) {
        if (err.permanent) {
          console.error(`Resultado inválido; se descarta: ${err.message}`);
          settle(() => ch.nack(msg, false, false));
        } else {
          console.error('Error aplicando el resultado de stock; se reintentará:', err.message);
          await sleep(CONSUMER_RETRY_DELAY_MS);
          settle(() => ch.nack(msg, false, true));
        }
      }
    });
  }

  async function openChannel() { // abre la conexión y el canal con RabbitMQ, declara la topología y deja registrado el consumidor de resultados de stock
    const conn = await amqp.connect(url);
    conn.on('error', (err) => console.error('Error en la conexión con RabbitMQ:', err.message));
    conn.on('close', () => {
      if (closing) return;
      console.warn('Se perdió la conexión con RabbitMQ; reconectando...');
      connection = null;
      channel = null;
      reconnectLoop();
    });

    try {
      const ch = await conn.createConfirmChannel();
      ch.on('error', (err) => console.error('Error en el canal de RabbitMQ:', err.message));
      await declareTopology(ch);
      if (stockResultHandler) await startConsuming(ch);
      connection = conn;
      channel = ch;
    } catch (err) {
      conn.removeAllListeners('close');
      await conn.close().catch(() => {});
      throw err;
    }
  }

  async function reconnectLoop() { // si se pierde la conexión, intenta reconectar cada 2 segundos hasta que vuelva a estar disponible
    if (reconnecting) return;
    reconnecting = true;
    while (!closing) {
      try {
        await openChannel();
        console.log('Reconectado a RabbitMQ');
        break;
      } catch (err) {
        console.log(`RabbitMQ sigue sin responder (${err.message}). Nuevo intento en ${RECONNECT_DELAY_MS / 1000}s...`);
        await sleep(RECONNECT_DELAY_MS);
      }
    }
    reconnecting = false;
  }

  // Conexión inicial: si el broker aún no arrancó, reintentamos un tiempo antes de rendirnos.
  for (let attempt = 1; ; attempt++) {
    try {
      await openChannel();
      break;
    } catch (err) {
      if (attempt >= initialRetries) throw err;
      console.log(`RabbitMQ no está listo (intento ${attempt}/${initialRetries}). Reintentando...`);
      await sleep(RECONNECT_DELAY_MS);
    }
  }

  return {
    // Lanza un error si el broker no está disponible o no confirma. Quien llama decide qué hacer
    // (la ruta POST lo registra y el relay lo reintentará más tarde).
    async publishOrderCreated(order) { // publica el evento OrderCreated en el exchange orderflow con la etiqueta order.created, y el contenido es el JSON del evento
      const ch = channel;
      if (!ch) throw new Error('RabbitMQ no está disponible');

      // El eventId viene guardado en el pedido y el resto del contenido también es estable:
      // si este evento se publica dos veces, el mensaje es idéntico y el worker lo detecta.
      const event = {
        eventId: order.eventId,
        orderId: order.id,
        sku: order.sku,
        cantidad: order.cantidad,
        ocurridoEn: new Date(order.creadoEn).toISOString(),
      };

      ch.publish(EXCHANGE, ROUTING_KEYS.orderCreated, Buffer.from(JSON.stringify(event)), {
        persistent: true, // el mensaje se guarda en disco
        contentType: 'application/json',
        messageId: event.eventId,
      });
      await withTimeout(ch.waitForConfirms(), PUBLISH_TIMEOUT_MS, 'RabbitMQ no confirmó el mensaje a tiempo');
    },

    // Registra quién procesa los resultados de stock. Si hay que reconectar, se vuelve a registrar solo.
    async consumeStockResults(handler) {
      stockResultHandler = handler;
      if (channel) await startConsuming(channel);
    },

    async close() {
      closing = true;
      if (channel) await channel.close().catch(() => {});
      if (connection) await connection.close().catch(() => {});
    },
  };
}

module.exports = { createMessaging };
