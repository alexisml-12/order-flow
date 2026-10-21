const GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Un mensaje mal formado nunca se va a arreglar reintentándolo, así que se marca como "permanente":
// el consumidor lo descarta en lugar de reencolarlo infinitamente.
class InvalidMessageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidMessageError';
    this.permanent = true;
  }
}

function assertValidOrderCreated(event) {
  const valid =
    event &&
    typeof event.eventId === 'string' && GUID_REGEX.test(event.eventId) &&
    typeof event.orderId === 'string' && GUID_REGEX.test(event.orderId) &&
    typeof event.sku === 'string' && event.sku.length > 0 &&
    Number.isInteger(event.cantidad) && event.cantidad >= 1;

  if (!valid) {
    throw new InvalidMessageError('El evento OrderCreated no tiene el formato esperado');
  }
}

// Orquestación del caso de uso: reservar stock y publicar el resultado.
// El mensaje solo se confirma (ack) DESPUÉS de que esta función termina sin error.
// Si falla la publicación, el mensaje se reentrega, se detecta como duplicado
// y se vuelve a publicar el resultado ya guardado (sin descontar de nuevo).
async function handleOrderCreated(event, { repo, publisher }) {
  assertValidOrderCreated(event);
  const { resultado, duplicado } = await repo.reserveStock(event);
  await publisher.publishStockResult(resultado, event);
  return { resultado, duplicado };
}

module.exports = { handleOrderCreated, InvalidMessageError };
