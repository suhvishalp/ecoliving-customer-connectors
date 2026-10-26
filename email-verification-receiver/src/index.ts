import 'dotenv/config';
import express, { type Express } from 'express';
import { readConfiguration } from './utils/config.utils.js';
import { logger } from './utils/logger.utils.js';
import { correlationMiddleware } from './middleware/correlation.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import confirmRouter from './routes/confirm.route.js';
import statusRouter from './routes/status.route.js';

readConfiguration();

export const app: Express = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(correlationMiddleware);

app.use('/status', statusRouter);
// Must match `endpoint` in connect.yaml, and the link the sender builds in `connector` mode.
app.use('/email-verification-confirm', confirmRouter);

app.use(errorMiddleware);

const PORT = Number(process.env.PORT ?? 8080);
/* c8 ignore start */
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => logger.info('email-verification-receiver listening', { port: PORT }));
}
/* c8 ignore stop */
export default app;
