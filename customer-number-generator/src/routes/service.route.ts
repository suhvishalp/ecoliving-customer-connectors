import { Router } from 'express';
import { post } from '../controllers/customer-number.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const serviceRouter: Router = Router();

/**
 * Mounted at the `endpoint` declared in connect.yaml (`/customer-number`). If the two ever disagree the
 * platform's traffic 404s and the Extension fails every sign-up — so they are asserted in the tests.
 */
serviceRouter.post('/', authMiddleware, (req, res, next) => {
  post(req, res).catch(next);
});

export default serviceRouter;
