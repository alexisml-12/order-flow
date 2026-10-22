const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateOrderInput } = require('../src/validation');

// Test 1 - Validación del pedido (clienteNombre no vacío, cantidad entera entre 1 y 100).
test('validación: rechaza datos inválidos y acepta datos válidos', () => {
  const sinNombre = validateOrderInput({ clienteNombre: '   ', sku: 'ABC-01', cantidad: 0 });
  assert.deepEqual(sinNombre.errors.map((e) => e.campo).sort(), ['cantidad', 'clienteNombre']);

  for (const cantidad of [101, 1.5, '5', undefined]) {
    const result = validateOrderInput({ clienteNombre: 'Ana', sku: 'ABC-01', cantidad });
    assert.deepEqual(result.errors.map((e) => e.campo), ['cantidad']);
  }

  const valido = validateOrderInput({ clienteNombre: ' Ana ', sku: 'ABC-01', cantidad: 100 });
  assert.deepEqual(valido.errors, []);
  assert.deepEqual(valido.value, { clienteNombre: 'Ana', sku: 'ABC-01', cantidad: 100 });
});
