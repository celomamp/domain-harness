// Ending a pg.Pool and waiting for its connections to close.
import type pg from "pg";

/**
 * End `pool` and resolve only once every client's connection has closed.
 *
 * pg-pool's own `end()` resolves as soon as it has dropped its clients from
 * its list, before their `client.end()` calls finish. A backend can therefore
 * still be alive when the caller moves on: a `drop database ... with (force)`
 * issued right after terminates it, the server sends FATAL 57P01 ("terminating
 * connection due to administrator command") to the half-closed client, and the
 * pool re-emits that as an `error` event nobody listens to.
 */
export async function endPool(pool: pg.Pool): Promise<void> {
  let open = pool.totalCount;
  const closed =
    open === 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          pool.on("remove", () => {
            open -= 1;
            if (open === 0) resolve();
          });
        });
  await pool.end();
  await closed;
}
