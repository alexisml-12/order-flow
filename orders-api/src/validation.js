// Validación pura (sin base de datos): fácil de probar con tests unitarios.
// La comprobación de que el sku exista en el catálogo se hace aparte, en la ruta.

function validateOrderInput(body) {
  const errors = [];
  const data = body && typeof body === 'object' ? body : {};

  const clienteNombre = typeof data.clienteNombre === 'string' ? data.clienteNombre.trim() : '';
  if (!clienteNombre) {
    errors.push({ campo: 'clienteNombre', mensaje: 'El nombre del cliente es obligatorio' });
  } else if (clienteNombre.length > 200) {
    errors.push({ campo: 'clienteNombre', mensaje: 'El nombre del cliente no puede superar 200 caracteres' });
  }

  const sku = typeof data.sku === 'string' ? data.sku.trim() : '';
  if (!sku) {
    errors.push({ campo: 'sku', mensaje: 'El sku es obligatorio' });
  }

  const cantidad = data.cantidad;
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100) {
    errors.push({ campo: 'cantidad', mensaje: 'La cantidad debe ser un entero entre 1 y 100' });
  }

  return { errors, value: { clienteNombre, sku, cantidad } };
}

module.exports = { validateOrderInput };
