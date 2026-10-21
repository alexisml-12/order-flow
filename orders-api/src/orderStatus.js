// Reglas de negocio de los estados de un pedido (sin base de datos ni RabbitMQ: fáciles de probar).

const STATUS = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  REJECTED: 'Rejected',
};

// Qué estado corresponde a cada evento que publica el Inventory Worker.
const RESULT_TO_STATUS = {
  StockReserved: STATUS.CONFIRMED,
  StockRejected: STATUS.REJECTED,
};

function statusFromResult(tipo) {
  return RESULT_TO_STATUS[tipo] ?? null;
}

// Un pedido solo puede salir de Pending. Confirmed y Rejected son estados finales.
function canTransition(from, to) {
  return from === STATUS.PENDING && (to === STATUS.CONFIRMED || to === STATUS.REJECTED);
}

module.exports = { STATUS, statusFromResult, canTransition };
