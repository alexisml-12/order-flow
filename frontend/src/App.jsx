import { useCallback, useEffect, useState } from 'react';
import { listOrders } from './api.js';
import OrderForm from './OrderForm.jsx';
import OrderList from './OrderList.jsx';

const POLL_INTERVAL_MS = 3000;

// App es dueña del estado de la lista de pedidos y de su actualización periódica (polling).
// OrderList solo muestra datos; OrderForm solo crea pedidos y avisa cuando termina.
export default function App() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const refresh = useCallback(async (signal) => {
    try {
      setOrders(await listOrders(signal));
      setLoadError(null);
    } catch (err) {
      if (err.name === 'AbortError') return;
      // Se conserva la última lista conocida: un fallo puntual no debe vaciar la pantalla.
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    const timer = setInterval(() => refresh(controller.signal), POLL_INTERVAL_MS);

    // Al desmontar el componente se detiene el polling y se cancela la petición en curso.
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [refresh]);

  return (
    <main>
      <h1>OrderFlow · Panel de pedidos</h1>
      <div className="layout">
        <section className="card">
          <h2>Nuevo pedido</h2>
          <OrderForm onCreated={() => refresh()} />
        </section>
        <section className="card">
          <h2>Pedidos</h2>
          <OrderList orders={orders} loading={loading} error={loadError} />
        </section>
      </div>
    </main>
  );
}
