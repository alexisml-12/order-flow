const { statusFromResult, canTransition } = require('./orderStatus');

const GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Un mensaje mal formado nunca se arregla reintentándolo: se marca como "permanente"
// y el consumidor lo descarta en lugar de reencolarlo infinitamente.
class InvalidMessageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidMessageError';
    this.permanent = true;
  }
}

function assertValidStockResult(event) {
  const valid =
    event &&
    typeof event.orderId === 'string' && GUID_REGEX.test(event.orderId) &&
    statusFromResult(event.tipo) !== null;

  if (!valid) {
    throw new InvalidMessageError('El resultado de stock no tiene el formato esperado');
  }
}

// Aplica el resultado de Inventory al pedido. Es idempotente: si el mismo resultado llega
// dos veces (o llega uno contradictorio tarde), el pedido NO vuelve a cambiar.
// Devuelve { aplicado, estado?, motivo? } para poder loguear qué pasó.
async function handleStockResult(event, { repo }) {
  assertValidStockResult(event);
  const nuevoEstado = statusFromResult(event.tipo);

  const order = await repo.getById(event.orderId);
  if (!order) {
    return { aplicado: false, motivo: 'el pedido no existe' };
  }
  if (!canTransition(order.estado, nuevoEstado)) {
    return { aplicado: false, motivo: `el pedido ya estaba ${order.estado}` };
  }

  // El UPDATE vuelve a exigir estado = 'Pending', así que es seguro aunque dos mensajes compitan.
  const aplicado = await repo.updateStatus(order.id, nuevoEstado);
  return aplicado
    ? { aplicado: true, estado: nuevoEstado }
    : { aplicado: false, motivo: 'otro proceso ya cambió el estado' };
}

module.exports = { handleStockResult, InvalidMessageError };
