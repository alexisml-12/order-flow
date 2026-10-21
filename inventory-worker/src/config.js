// Toda la configuración viene de variables de entorno. Nada hardcodeado.

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno obligatoria: ${name}`);
  }
  return value;
}

function buildRabbitUrl() {
  const host = required('RABBITMQ_HOST');
  const port = process.env.RABBITMQ_PORT || '5672';
  const user = encodeURIComponent(required('RABBITMQ_USER'));
  const password = encodeURIComponent(required('RABBITMQ_PASSWORD'));
  return `amqp://${user}:${password}@${host}:${port}`;
}

function loadConfig() {
  return {
    rabbitUrl: buildRabbitUrl(),
    db: {
      server: required('DB_HOST'),
      port: Number(process.env.DB_PORT || 1433),
      user: required('DB_USER'),
      password: required('DB_PASSWORD'),
      database: process.env.DB_NAME || 'OrderFlowDb',
      options: {
        encrypt: false,
        trustServerCertificate: true,
      },
    },
  };
}

module.exports = { loadConfig };
