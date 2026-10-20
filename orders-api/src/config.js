// Toda la configuración viene de variables de entorno. Nada hardcodeado.

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno obligatoria: ${name}`);
  }
  return value;
}

function loadConfig() {
  return {
    port: Number(process.env.PORT || 3000),
    corsOrigin: process.env.CORS_ORIGIN || '*',
    db: {
      server: required('DB_HOST'),
      port: Number(process.env.DB_PORT || 1433),
      user: required('DB_USER'),
      password: required('DB_PASSWORD'),
      database: process.env.DB_NAME || 'OrderFlowDb',
      options: {
        encrypt: false, // contenedor local sin TLS
        trustServerCertificate: true,
      },
    },
  };
}

module.exports = { loadConfig };
