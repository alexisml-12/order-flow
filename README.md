# OrderFlow

Sistema de pedidos con reserva de inventario asíncrona: un panel web registra pedidos, **Orders API** los guarda y publica un evento, y **Inventory Worker** intenta reservar el stock y responde. Los servicios se comunican por **RabbitMQ**.

## Cómo correr todo (menos de 10 minutos)

Requisito: Docker Desktop en ejecución.

```bash
docker compose up
```

Con ese único comando se construyen y levantan el frontend, los dos servicios, RabbitMQ y SQL Server, y se carga el seed (3 productos con stock 100). No hace falta crear ningún archivo `.env`.

La primera vez tarda unos minutos porque construye las imágenes y descarga las de SQL Server y RabbitMQ. Si luego modificas el código, usa `docker compose up --build` para reconstruirlas. SQL Server necesita cerca de un minuto en estar listo: los mensajes de reintento en los logs son normales.

| Qué | Dirección |
|---|---|
| Panel de pedidos | http://localhost:8080 |
| Orders API | http://localhost:3000 (`/orders`, `/health`) |
| Panel de RabbitMQ | http://localhost:15672 (usuario `orderflow`, clave `orderflow_demo`) |

Si el puerto 8080 de tu máquina está ocupado, define `FRONTEND_PORT=8081` (o el que prefieras) en un archivo `.env` y vuelve a ejecutar el comando.

### Configuración (variables de entorno)

Todo se configura por variables de entorno; nada está escrito en el código de los servicios. `docker-compose.yml` lee un archivo `.env` opcional (ver `.env.example`). Si no existe, usa valores por defecto de demostración.

| Variable | Para qué sirve | Valor por defecto |
|---|---|---|
| `MSSQL_SA_PASSWORD` | Contraseña de SQL Server | `OrderFlow_Demo_2026` |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | Credenciales de RabbitMQ | `orderflow` / `orderflow_demo` |
| `DB_NAME` | Nombre de la base de datos | `OrderFlowDb` |
| `FRONTEND_PORT` | Puerto del panel en tu máquina | `8080` |
| `VITE_API_URL` | Dirección de la API vista desde el navegador | `http://localhost:3000` |

### Tests

Requiere Node 20.6 o superior.

```bash
npm --prefix orders-api install
npm --prefix inventory-worker install
npm test
```

Son 5 tests con el ejecutor de pruebas incluido en Node (`node --test`). Cubren validación, transiciones de estado e idempotencia. El test de idempotencia usa SQL Server real (`docker compose up -d` antes); si no está disponible, se omite en lugar de fallar.

## Arquitectura

```
[React] --POST /orders--> [Orders API] --guarda Pending--> [SQL Server]
                              |
                              | OrderCreated  (routing key order.created)
                              v
                          [RabbitMQ]  exchange "orderflow"
                              |  cola inventory.order-created
                              v
                       [Inventory Worker] --descuenta stock--> [SQL Server]
                              |
                              | StockReserved / StockRejected
                              v
                          [RabbitMQ]  cola orders.stock-result
                              |
                              v
                        [Orders API] --Confirmed / Rejected--> [SQL Server]
```

- **Orders API** (Node.js + Express): valida, persiste con estado `Pending`, publica `OrderCreated` y escucha los resultados para pasar el pedido a `Confirmed` o `Rejected`.
- **Inventory Worker** (Node.js): consume `OrderCreated`, descuenta el stock y publica el resultado.
- **Frontend** (React + Vite, servido con nginx): formulario con validaciones y lista que se refresca cada 3 segundos (polling).

Endpoints: `POST /orders` (201 o 400 con la lista de errores por campo), `GET /orders`, `GET /orders/{id}`.

## Decisiones de arquitectura

- **Node.js en lugar de .NET:** es el lenguaje que mas he trabajado para backend en los ultimos años y con el que me siento mas comodo.
- **RabbitMQ** con un exchange directo y colas durables; mensajes persistentes y *publisher confirms* para no perder eventos si el broker se reinicia.
- **SQL Server, una sola base de datos** con las tablas `Products` (con su `stock`), `Orders` y `ProcessedEvents`. Es el motor que mejor conozco y permite descontar el stock y registrar el evento en una sola transacción.
- **Idempotencia en el consumidor:** la tabla `ProcessedEvents` tiene `eventId` como llave primaria. En una transacción, el worker descuenta el stock (`UPDATE ... WHERE stock >= cantidad`) y registra el `eventId`. Si el evento ya existía, el `INSERT` falla, se deshace todo (incluido el descuento) y se devuelve el resultado guardado.
- **`ack` al final:** el worker confirma el mensaje solo después de reservar el stock y publicar el resultado. Si se cae en medio, RabbitMQ lo reentrega y la idempotencia evita descontar dos veces.
- **Cambios de estado seguros:** `UPDATE ... WHERE estado = 'Pending'`; un resultado repetido o tardío no modifica un pedido ya confirmado o rechazado.
- **Esquema y seed idempotentes:** Orders API crea las tablas y el seed al arrancar (se puede ejecutar en cada arranque); el worker espera a que existan.
- **El frontend llama directo a la API** (CORS habilitado), sin proxy intermedio, para mantener pocas piezas.

### Demostrar la idempotencia

1. Automático: el test de integración procesa el mismo evento dos veces y comprueba que el stock bajó una sola vez.
2. Manual: crea un pedido, copia el `eventId` que muestra el log del worker (`docker compose logs inventory-worker`) y, en el panel de RabbitMQ, publica en el exchange `orderflow` (routing key `order.created`) el mismo evento con ese `eventId`. El worker registra "evento duplicado" y el stock no cambia.

## Manejo de fallos

| Situación | Qué pasa |
|---|---|
| **Inventory no responde** | Los eventos esperan en la cola durable `inventory.order-created`; los pedidos siguen `Pending` y se procesan cuando el worker vuelve. No hay tiempo máximo de espera (ver "Qué haría distinto"). |
| **RabbitMQ caído cuando Orders publica** | El pedido ya está guardado y la API responde `201`. Como no se pudo publicar, el pedido queda con `publicadoEn` vacío; un *relay* revisa cada 10 segundos los pedidos sin publicar y los publica cuando el broker vuelve. Cada pedido guarda su `eventId`, así que una republicación es idéntica y el worker la detecta como duplicado. |
| **RabbitMQ se cae con Orders corriendo** | Orders detecta el cierre, reintenta cada 2 segundos y vuelve a registrar su consumidor al reconectar. |
| **RabbitMQ se cae con el worker corriendo** | El worker se detiene a propósito y `restart: unless-stopped` lo reinicia; al arrancar reintenta hasta que el broker vuelva. |
| **Error temporal al procesar un mensaje** | No se hace `ack`; tras 2 segundos el mensaje vuelve a la cola. |
| **Mensaje mal formado** | Se descarta sin reintentos (reintentarlo nunca lo arreglaría). |

## Trade-offs asumidos

- **Base de datos compartida:** Orders y Inventory comparten el esquema, así que un cambio en `Products` afecta a ambos. A cambio se obtiene una transacción atómica en el consumidor y se evitan datos duplicados.
- **Código de mensajería repetido** en cada servicio, en lugar de un paquete compartido.
- **Credenciales de demostración por defecto en `docker-compose.yml`** para que `docker compose up` funcione sin pasos previos; se pueden reemplazar con un `.env`.
- **Polling cada 3 segundos** en lugar de websockets: más simple y suficiente para el caso.
- **SKU de texto libre** en el formulario: la API no expone un endpoint de productos.
- **El relay puede publicar un evento dos veces** (por ejemplo, si falla el marcado de `publicadoEn`); es seguro por la idempotencia del worker.
- **Sin healthcheck de SQL Server:** los servicios ya reintentan la conexión, así que `depends_on` solo espera a que el contenedor haya arrancado.

## Qué haría distinto con más tiempo

- **Dead-letter queue** para los mensajes inválidos, en lugar de descartarlos.
- **Expiración de pedidos `Pending`** (y alertas) cuando Inventory tarda demasiado.
- **Una base de datos por servicio**, con un catálogo de productos único o sincronizado por eventos.
- **Migraciones versionadas** del esquema (hoy solo se crea lo que no existe).
- **Paquete compartido** para la mensajería y los contratos de los eventos.
- **Tests de integración de punta a punta** (por ejemplo con Testcontainers) y tests del frontend.
- **Logs estructurados, métricas y un `GET /products`** para ofrecer un desplegable de SKU.
- **Bonus no implementados:** Kubernetes, .NET y actualización en tiempo real con websockets o SignalR.
