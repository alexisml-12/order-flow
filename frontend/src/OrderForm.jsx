import { useEffect, useState } from 'react';
import { createOrder, ApiError } from './api.js';

const EMPTY_FORM = { clienteNombre: '', sku: '', cantidad: '' };
const SUCCESS_MESSAGE_MS = 5000;

// Validación en el navegador: da respuesta inmediata. La API valida de nuevo (es la que manda).
function validate({ clienteNombre, sku, cantidad }) {
  const errors = {};
  if (!clienteNombre.trim()) errors.clienteNombre = 'El nombre del cliente es obligatorio';
  if (!sku.trim()) errors.sku = 'El sku es obligatorio';
  const qty = Number(cantidad);
  if (cantidad === '' || !Number.isInteger(qty) || qty < 1 || qty > 100) {
    errors.cantidad = 'La cantidad debe ser un entero entre 1 y 100';
  }
  return errors;
}

function Field({ label, name, error, ...inputProps }) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <input id={name} name={name} aria-invalid={Boolean(error)} {...inputProps} />
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

// onCreated es un callback: App se lo entrega al formulario para que lo ejecute
// cuando el pedido se haya creado (así la lista se refresca al instante).
export default function OrderForm({ onCreated }) {
  const [values, setValues] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({}); // errores por campo
  const [formError, setFormError] = useState(null); // errores generales (red, servidor)
  const [success, setSuccess] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // El mensaje de éxito desaparece solo a los 5 segundos. Si llega otro mensaje antes,
  // o el componente se desmonta, se cancela el temporizador anterior.
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), SUCCESS_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [success]);

  function handleChange(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSuccess(null);
    setFormError(null);

    const errors = validate(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const order = await createOrder({
        clienteNombre: values.clienteNombre.trim(),
        sku: values.sku.trim(),
        cantidad: Number(values.cantidad),
      });
      setSuccess(`Pedido ${order.id.slice(0, 8)} creado. Estado inicial: ${order.estado}.`);
      setValues(EMPTY_FORM);
      onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.details.length > 0) {
        // La API rechazó los datos: mostramos cada mensaje junto a su campo.
        setFieldErrors(Object.fromEntries(err.details.map((d) => [d.campo, d.mensaje])));
      } else {
        setFormError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {formError && <p className="banner banner-error" role="alert">{formError}</p>}
      {success && <p className="banner banner-success" role="status">{success}</p>}

      <Field
        label="Cliente"
        name="clienteNombre"
        value={values.clienteNombre}
        onChange={handleChange}
        error={fieldErrors.clienteNombre}
      />
      <Field
        label="SKU"
        name="sku"
        placeholder="Ej: ABC-01"
        value={values.sku}
        onChange={handleChange}
        error={fieldErrors.sku}
      />
      <Field
        label="Cantidad"
        name="cantidad"
        type="number"
        min="1"
        max="100"
        placeholder="Entre 1 y 100"
        value={values.cantidad}
        onChange={handleChange}
        error={fieldErrors.cantidad}
      />

      <button type="submit" disabled={submitting}>
        {submitting ? 'Enviando...' : 'Crear pedido'}
      </button>
    </form>
  );
}
