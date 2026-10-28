import { Router, type IRouter } from "express";
import healthRouter from "./health";
import experiencesRouter from "./experiences";
import webPushRouter from "./web-push";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/experiences", experiencesRouter);
router.use("/web-push", webPushRouter);

export default router;
