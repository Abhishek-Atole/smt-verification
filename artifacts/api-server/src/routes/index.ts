import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import bomRouter from "./bom";
import bomComprehensiveRouter from "./bom-comprehensive";
import sessionsRouter from "./sessions";
import analyticsRouter from "./analytics";
import feedersRouter from "./feeders";
import componentsRouter from "./components";
import traceabilityRouter from "./traceability";
import auditRouter from "./audit";
import testRouter from "./test";
import trashRouter from "./trash";
import dashboardRouter from "./dashboard";
import timestampRouter from "./timestamp";
import reportsRouter from "./reports";
import verificationRouter from "./verification";
import authRouter from "./auth";
import notificationsRouter from "./notifications";
import approversRouter from "./approvers";
import qaRejectionsRouter from "./qa-rejections";
import mastersRouter from "./masters";
import documentControlRouter from "./document-control";
import inspectionLogRouter from "./inspection-log";
import bypassRouter from "./bypass";


const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(bomRouter);
router.use(bomComprehensiveRouter);
router.use(sessionsRouter);
router.use(analyticsRouter);
router.use(feedersRouter);
router.use(componentsRouter);
router.use(traceabilityRouter);
router.use(auditRouter);
router.use(testRouter);
router.use(trashRouter);
router.use(dashboardRouter);
router.use(timestampRouter);
router.use(reportsRouter);
router.use(verificationRouter);
router.use(notificationsRouter);
router.use(approversRouter);
router.use(qaRejectionsRouter);
router.use(mastersRouter);
router.use(documentControlRouter);
router.use(inspectionLogRouter);
router.use(bypassRouter);


export default router;
