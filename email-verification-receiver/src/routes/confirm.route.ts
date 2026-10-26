import { Router } from 'express';
import { getConfirm, postConfirm } from '../controllers/confirm.controller.js';

/** Mounted at the `endpoint` declared in connect.yaml (`/email-verification-confirm`). */
const confirmRouter: Router = Router();
confirmRouter.get('/', (req, res, next) => {
  getConfirm(req, res).catch(next);
});
confirmRouter.post('/', (req, res, next) => {
  postConfirm(req, res).catch(next);
});
export default confirmRouter;
