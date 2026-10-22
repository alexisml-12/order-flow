const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handleOrderCreated, InvalidMessageError } = require('../src/handleOrderCreated');

// Test 4 - Si el mismo evento llega otra vez, el worker no falla: vuelve a publicar el resultado guardado.
test('idempotencia: un evento duplicado republica el resultado ya guardado', async () => {
  const published = [];
  const repo = {
    // Simula lo que devuelve el repositorio cuando el eventId ya estaba en ProcessedEvents
    async reserveStock() {
      return { resultado: 'StockReserved', duplicado: true };
    },
  };
  const publisher = {
    async publishStockResult(resultado, event) {
      published.push({ resultado, orderId: event.orderId });
    },
  };

  const event = {
    eventId: '54aef24d-5c3a-49fb-96cd-b6f5834ba846',
    orderId: 'bd06daf6-39aa-419b-ac44-0bc4adb9d05d',
    sku: 'ABC-01',
    cantidad: 2,
  };

  const result = await handleOrderCreated(event, { repo, publisher });

  assert.deepEqual(result, { resultado: 'StockReserved', duplicado: true });
  assert.deepEqual(published, [{ resultado: 'StockReserved', orderId: event.orderId }]);

  // Un mensaje mal formado se rechaza como "permanente" (no se reintenta)
  await assert.rejects(() => handleOrderCreated({ hola: 'mundo' }, { repo, publisher }), InvalidMessageError);
});
