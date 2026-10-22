const GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Qué estado corresponde a cada evento que publica el Inventory Worker.
const RESULT_TO_STATUS = {
  StockReserved: 'Confirmed',
  StockRejected: 'Rejected',
};

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
    Object.hasOwn(RESULT_TO_STATUS, event.tipo);

  if (!valid) {
    throw new InvalidMessageError('El resultado de stock no tiene el formato esperado');
  }
}

// Aplica el resultado de Inventory al pedido.
// El UPDATE del repositorio solo cambia pedidos que siguen en Pending. Por eso es idempotente:
// si el mismo resultado llega dos veces (o llega uno tardío), el pedido no vuelve a cambiar.
// Devuelve { aplicado, estado?, motivo? } para poder loguear qué pasó.
async function handleStockResult(event, { repo }) {
  assertValidStockResult(event);
  const nuevoEstado = RESULT_TO_STATUS[event.tipo];

  const aplicado = await repo.updateStatus(event.orderId, nuevoEstado);
  return aplicado
    ? { aplicado: true, estado: nuevoEstado }
    : { aplicado: false, motivo: 'el pedido no existe o ya no estaba Pending' };
}

module.exports = { handleStockResult, InvalidMessageError };
