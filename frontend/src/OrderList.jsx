const STATUS_LABELS = {
  Pending: 'Pendiente',
  Confirmed: 'Confirmado',
  Rejected: 'Rechazado',
};

// Componente de presentación: recibe los datos por props y no sabe nada de la API.
export default function OrderList({ orders, loading, error }) {
  return (
    <>
      {error && (
        <p className="banner banner-error" role="alert">
          No se pudo actualizar la lista ({error}). Se reintentará automáticamente.
        </p>
      )}

      {loading ? (
        <p className="muted">Cargando pedidos...</p>
      ) : orders.length === 0 ? (
        <p className="muted">Todavía no hay pedidos. Crea el primero con el formulario.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Cliente</th>
              <th>SKU</th>
              <th>Cant.</th>
              <th>Estado</th>
              <th>Creado</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td title={order.id}>{order.id.slice(0, 8)}</td>
                <td>{order.clienteNombre}</td>
                <td>{order.sku}</td>
                <td>{order.cantidad}</td>
                <td>
                  <span className={`badge ${order.estado.toLowerCase()}`}>
                    {STATUS_LABELS[order.estado] ?? order.estado}
                  </span>
                </td>
                <td>{new Date(order.creadoEn).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
