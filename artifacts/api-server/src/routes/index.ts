import { Router, type IRouter } from "express";
import healthRouter from "./health";
import experiencesRouter from "./experiences";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/experiences", experiencesRouter);

export default router;
