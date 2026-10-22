const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handleStockResult, InvalidMessageError } = require('../src/handleStockResult');

const ORDER_ID = '2513493c-865f-4dc6-a46f-27b863328085';

// Repositorio falso: registra con qué estado se intentó actualizar y devuelve lo que le indiquemos.
function fakeRepo(updateResult) {
  const calls = [];
  return {
    calls,
    async updateStatus(id, status) {
      calls.push({ id, status });
      return updateResult;
    },
  };
}

// Test 2 - Transiciones de estado: cada resultado de Inventory lleva el pedido a su estado final.
test('transiciones: StockReserved confirma el pedido y StockRejected lo rechaza', async () => {
  const repo = fakeRepo(true);

  const reserved = await handleStockResult({ orderId: ORDER_ID, tipo: 'StockReserved' }, { repo });
  const rejected = await handleStockResult({ orderId: ORDER_ID, tipo: 'StockRejected' }, { repo });

  assert.deepEqual(reserved, { aplicado: true, estado: 'Confirmed' });
  assert.deepEqual(rejected, { aplicado: true, estado: 'Rejected' });
  assert.deepEqual(repo.calls.map((c) => c.status), ['Confirmed', 'Rejected']);
});

// Test 3 - Un resultado repetido o tardío no cambia un pedido que ya salió de Pending.
// (La garantía real es el "WHERE estado = 'Pending'" del UPDATE: aquí simulamos que no encontró filas.)
test('transiciones: ignora resultados repetidos y descarta mensajes inválidos', async () => {
  const repo = fakeRepo(false);

  const result = await handleStockResult({ orderId: ORDER_ID, tipo: 'StockRejected' }, { repo });
  assert.equal(result.aplicado, false);

  await assert.rejects(
    () => handleStockResult({ orderId: ORDER_ID, tipo: 'Otra' }, { repo }),
    InvalidMessageError,
  );
});
