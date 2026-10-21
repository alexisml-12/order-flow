const sql = require('mssql');

// Números de error de SQL Server cuando se viola una llave primaria / índice único.
const DUPLICATE_KEY_ERRORS = [2627, 2601];

function sqlErrorNumber(err) {
  return err.number ?? err.originalError?.info?.number;
}

async function getProcessedResult(pool, eventId) {
  const result = await pool
    .request()
    .input('eventId', sql.UniqueIdentifier, eventId)
    .query('SELECT resultado FROM dbo.ProcessedEvents WHERE eventId = @eventId');
  return result.recordset[0]?.resultado ?? null;
}

function createInventoryRepository(pool) {
  return {
    /**
     * Intenta reservar stock para un evento. Es IDEMPOTENTE:
     * procesar dos veces el mismo eventId descuenta el stock una sola vez.
     *
     * Dentro de UNA transacción:
     *   1) descuenta el stock solo si alcanza (UPDATE ... WHERE stock >= cantidad)
     *   2) registra el eventId en ProcessedEvents (llave primaria = guardia anti-duplicados)
     * Si el paso 2 falla porque el eventId ya existía, se hace ROLLBACK de TODO
     * (incluido el descuento del paso 1) y se devuelve el resultado ya guardado.
     *
     * Devuelve { resultado: 'StockReserved' | 'StockRejected', duplicado: boolean }
     */
    async reserveStock({ eventId, orderId, sku, cantidad }) {
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        const update = await new sql.Request(tx)
          .input('sku', sql.NVarChar(50), sku)
          .input('cantidad', sql.Int, cantidad)
          .query('UPDATE dbo.Products SET stock = stock - @cantidad WHERE sku = @sku AND stock >= @cantidad');

        const resultado = update.rowsAffected[0] === 1 ? 'StockReserved' : 'StockRejected';

        await new sql.Request(tx)
          .input('eventId', sql.UniqueIdentifier, eventId)
          .input('orderId', sql.UniqueIdentifier, orderId)
          .input('resultado', sql.NVarChar(20), resultado)
          .query('INSERT INTO dbo.ProcessedEvents (eventId, orderId, resultado) VALUES (@eventId, @orderId, @resultado)');

        await tx.commit();
        return { resultado, duplicado: false };
      } catch (err) {
        await tx.rollback().catch(() => {});

        if (DUPLICATE_KEY_ERRORS.includes(sqlErrorNumber(err))) {
          const resultado = await getProcessedResult(pool, eventId);
          if (resultado) return { resultado, duplicado: true };
        }
        throw err;
      }
    },
  };
}

module.exports = { createInventoryRepository };
