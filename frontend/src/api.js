// Único lugar del frontend que sabe cómo hablar con Orders API.
// La dirección de la API sale de la variable VITE_API_URL (se fija al construir el frontend).
// Si no se define, se usa http://localhost:3000, que es donde la API queda publicada.
// El navegador llama directo a la API: por eso Orders API tiene CORS habilitado.

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Error con la información que la interfaz necesita para mostrarlo bien.
export class ApiError extends Error {
  constructor(message, { status, details = [] } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details; // lista [{ campo, mensaje }] cuando la API responde 400
  }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err; // cancelación voluntaria: no es un error de red
    throw new ApiError('No se pudo conectar con el servidor. Inténtalo de nuevo en unos segundos.');
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(body?.error ?? `Error inesperado del servidor (${response.status})`, {
      status: response.status,
      details: body?.detalles ?? [],
    });
  }
  return body;
}

export const listOrders = (signal) => request('/orders', { signal });

export const createOrder = (order) =>
  request('/orders', { method: 'POST', body: JSON.stringify(order) });
