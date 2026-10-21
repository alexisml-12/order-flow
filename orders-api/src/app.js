const express = require('express');
const { validateOrderInput } = require('./validation');

const GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// createApp recibe sus dependencias (repo) por parámetro: así en los tests
// podemos pasarle un repositorio falso sin necesidad de SQL Server.
function createApp({ repo, publisher, corsOrigin = '*' }) {
  const app = express();
  app.use(express.json());

  // CORS mínimo para que el frontend (otro origen en desarrollo) pueda llamar a la API.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', corsOrigin);
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.post('/orders', async (req, res) => {
    const { errors, value } = validateOrderInput(req.body);

    // Consultamos el catálogo siempre que haya un sku, para devolver TODOS los errores a la vez.
    // (Si el sku viene vacío, validateOrderInput ya reportó que es obligatorio.)
    if (value.sku && !(await repo.skuExists(value.sku))) {
      errors.push({ campo: 'sku', mensaje: `El sku "${value.sku}" no existe en el catálogo` });
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Datos inválidos', detalles: errors });
    }

    //Crea el pedido en la base de datos con estado Pending. El id es un GUID generado por el servidor.
    const created = await repo.create(value);

    // El pedido ya está guardado como Pending. Intentamos publicar el evento de inmediato.
    // Si el broker no responde, el pedido NO se pierde: queda con publicadoEn = NULL y el relay
    // (outboxRelay.js) lo publicará cuando el broker vuelva. Si el evento se llegara a publicar dos
    // veces, el worker lo detecta como duplicado gracias al mismo eventId.
    try {
      await publisher.publishOrderCreated(created); // publica el evento OrderCreated en el exchange orderflow con la etiqueta order.created, y el contenido es el JSON del evento
      await repo.markPublished(created.id); // marca el pedido como publicado (actualiza publicadoEn = GETDATE()) para que el relay no lo vuelva a publicar
    } catch (err) {
      console.error(`OrderCreated del pedido ${created.id} quedó pendiente de publicar:`, err.message);
    }

    // eventId es un detalle interno: no se expone en la API.
    const { eventId: _eventId, ...order } = created;
    return res.status(201).json(order);
  });

  app.get('/orders', async (req, res) => {
    res.json(await repo.list());
  });

  app.get('/orders/:id', async (req, res) => {
    if (!GUID_REGEX.test(req.params.id)) {
      return res.status(400).json({ error: 'El id del pedido no es un GUID válido' });
    }
    const order = await repo.getById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    return res.json(order);
  });

  // Manejo centralizado de errores (Express 5 propaga los errores async hasta aquí).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'El cuerpo de la petición no es un JSON válido' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  });

  return app;
}

module.exports = { createApp };
