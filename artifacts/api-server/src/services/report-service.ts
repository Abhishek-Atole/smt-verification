import { db } from "@workspace/db";
import { sessionsTable, scanRecordsTable } from "@workspace/db/schema";
import { ReportFilters, FilterService } from "./filter-service";
import { AnalyticsService } from "./analytics-service";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Helper to extract rows from db.execute() result
 */
function extractRows(result: any): any[] {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.rows)) return result.rows;
  return [];
}

/**
 * Report data types for each report
 */
export interface FPYReportData {
  date: string;
  lineId?: string;
  pcbId?: string;
  totalFeeders: number;
  passFeeders: number;
  failFeeders: number;
  fpy: number;
}

export interface OEEReportData {
  sessionId: number;
  operatorName: string;
  durationHours: number;
  quality: number;
  efficiency: number;
  availability: number;
  oee: number;
}

export interface OperatorPerformanceData {
  operatorName: string;
  sessionsCount: number;
  totalScans: number;
  passRate: number;
  failRate: number;
  feedersPerMinute: number;
}

export interface OperatorComparisonData {
  operators: {
    operatorName: string;
    accuracy: number;
    speed: number;
    errors: number;
  }[];
}

export interface FeederPerformanceData {
  feederNumber: string;
  usageCount: number;
  failCount: number;
  errorRate: number;
  lastUsedAt: Date;
}

export interface FeederReliabilityData {
  feederNumber: string;
  repeatFailures: number;
  warningFrequency: number;
  lastFailedAt: Date;
}

export interface AlarmReportData {
  alarmType: string;
  feederNumber: string;
  mismatchCount: number;
  lastOccurredAt: Date;
  severity: number;
}

export interface ErrorAnalysisData {
  type: "feeder" | "component";
  identifier: string;
  failCount: number;
  errorRate: number;
}

export interface ComponentUsageData {
  mpn: string;
  manufacturer?: string;
  usageCount: number;
  failCount: number;
  bomUsageCount: number;
}

export interface LotTraceabilityData {
  lotNumber: string;
  dateCode?: string;
  usageCount: number;
  failCount: number;
  failRate: number;
  affectedFeeders: string[];
}

export interface TrendReportData {
  date: string;
  sessionsCount: number;
  totalScans: number;
  passCount: number;
  failCount: number;
  passRate: number;
  avgCycleTime: number;
}

/**
 * ReportService - Generates all 10 priority reports with SQL queries
 */
export class ReportService {
  /**
   * 1. FPY (First Pass Yield) Report
   * Formula (CORRECTED): (pass + alternate_pass + manual_pass) / (total - unvalidated) * 100
   * - Excludes unvalidated (FREE_SCAN) scans from denominator
   * - Includes alternate_pass as valid component match
   */
  static async generateFPYReport(filters: ReportFilters): Promise<FPYReportData[]> {
    try {
      FilterService.validateFilters(filters);
      const dateFilter = filters.dateFilter || "custom";
      const { startDate, endDate } = FilterService.buildDateQuery(
        dateFilter as any,
        filters.startDate && filters.endDate
          ? { startDate: filters.startDate, endDate: filters.endDate }
          : undefined
      );

      const query = sql`
        SELECT 
          DATE(sr.scanned_at) as date,
          COUNT(CASE WHEN sr.validation_result != 'unvalidated' THEN 1 END) as total_feeders,
          COUNT(CASE WHEN sr.validation_result IN ('pass', 'alternate_pass', 'manual_pass') THEN 1 END) as pass_feeders,
          COUNT(CASE WHEN sr.validation_result NOT IN ('pass', 'alternate_pass', 'manual_pass', 'unvalidated') THEN 1 END) as fail_feeders,
          ROUND(100.0 * COUNT(CASE WHEN sr.validation_result IN ('pass', 'alternate_pass', 'manual_pass') THEN 1 END) / NULLIF(COUNT(CASE WHEN sr.validation_result != 'unvalidated' THEN 1 END), 0), 2) as fpy
        FROM scan_records sr
        JOIN sessions s ON sr.session_id = s.id
        WHERE sr.scanned_at BETWEEN ${startDate} AND ${endDate}
          ${filters.lineId ? sql`AND s.supervisor_name = ${filters.lineId}` : sql``}
          ${filters.pcbId ? sql`AND s.panel_name = ${filters.pcbId}` : sql``}
          ${filters.operatorId ? sql`AND s.operator_name = ${filters.operatorId}` : sql``}
          ${filters.shiftId ? sql`AND s.shift_name = ${filters.shiftId}` : sql``}
        GROUP BY DATE(sr.scanned_at)
        ORDER BY date DESC;
      `;

      const results = await db.execute(query);
      return extractRows(results).map((row) => ({
        date: row.date || new Date().toISOString(),
        totalFeeders: row.total_feeders || 0,
        passFeeders: row.pass_feeders || 0,
        failFeeders: row.fail_feeders || 0,
        fpy: parseFloat(row.fpy || "0"),
      }));
    } catch (error) {
      logger.error({ err: error }, "FPY Report generation failed");
      return [];
    }
  }

  /**
   * 2. OEE (Overall Equipment Effectiveness) Report
   * Formula (CORRECTED): OEE = Availability × Efficiency × Quality
   * - Availability: 100% (no downtime tracking yet)
   * - Efficiency: Actual throughput / Expected throughput (scans/min / 5)
   * - Quality: (pass + alternate_pass + manual_pass) / (total - unvalidated)
   */
  static async generateOEEReport(filters: ReportFilters): Promise<OEEReportData[]> {
    try {
      FilterService.validateFilters(filters);
      const dateFilter = filters.dateFilter || "custom";
      const { startDate, endDate } = FilterService.buildDateQuery(
        dateFilter as any,
        filters.startDate && filters.endDate
          ? { startDate: filters.startDate, endDate: filters.endDate }
          : undefined
      );

      const query = sql`
        SELECT 
          s.id as session_id,
          s.operator_name,
          ROUND(EXTRACT(EPOCH FROM (s.end_time - s.start_time))::numeric / 3600, 2) as duration_hours,
          ROUND(100.0 * COUNT(CASE WHEN sr.validation_result IN ('pass', 'alternate_pass', 'manual_pass') THEN 1 END) / NULLIF(COUNT(CASE WHEN sr.validation_result != 'unvalidated' THEN 1 END), 0), 2) as quality,
          ROUND(COUNT(sr.id)::numeric / NULLIF(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60, 0), 2) as efficiency,
          100.0 as availability
        FROM scan_records sr
        JOIN sessions s ON sr.session_id = s.id
        WHERE sr.scanned_at BETWEEN ${startDate} AND ${endDate}
          AND s.end_time IS NOT NULL
          ${filters.operatorId ? sql`AND s.operator_name = ${filters.operatorId}` : sql``}
        GROUP BY s.id, s.operator_name
        ORDER BY session_id DESC;
      `;

      const results = await db.execute(query);
      return extractRows(results).map((row) => {
        const quality = Math.max(0, Math.min(1, parseFloat(row.quality || "0") / 100));
        const efficiency = Math.max(0, Math.min(1, parseFloat(row.efficiency || "0") / 5)); // Normalize by benchmark (5 scans/min)
        const availability = 1.0; // 100% for now
        const oee = quality * efficiency * availability * 100;

        return {
          sessionId: row.session_id,
          operatorName: row.operator_name,
          durationHours: parseFloat(row.duration_hours || "0"),
          quality: Math.round(quality * 100 * 10) / 10,
          efficiency: Math.round((parseFloat(row.efficiency || "0") / 5) * 100 * 10) / 10, // % of benchmark
          availability: 100,
          oee: Math.round(oee * 10) / 10,
        };
      });
    } catch (error) {
      logger.error({ err: error }, "OEE Report generation failed");
      return [];
    }
  }

  /**
   * 3. Operator Performance Report
   */
  static async generateOperatorReport(filters: ReportFilters): Promise<OperatorPerformanceData[]> {
    try {
      FilterService.validateFilters(filters);
      const dateFilter = filters.dateFilter || "custom";
      const { startDate, endDate } = FilterService.buildDateQuery(
        dateFilter as any,
        filters.startDate && filters.endDate
          ? { startDate: filters.startDate, endDate: filters.endDate }
          : undefined
      );

      const query = sql`
        SELECT 
          s.operator_name,
          COUNT(DISTINCT s.id) as sessions_count,
          COUNT(sr.id) as total_scans,
          ROUND(100.0 * COUNT(CASE WHEN sr.validation_result IN ('pass', 'pass_free_scan', 'alternate_pass') THEN 1 END) / NULLIF(COUNT(*), 0), 2) as pass_rate,
          ROUND(COUNT(sr.id)::numeric / NULLIF(SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60), 0), 2) as feeders_per_minute
        FROM scan_records sr
        JOIN sessions s ON sr.session_id = s.id
        WHERE sr.scanned_at BETWEEN ${startDate} AND ${endDate}
          ${filters.lineId ? sql`AND s.supervisor_name = ${filters.lineId}` : sql``}
        GROUP BY s.operator_name
        ORDER BY pass_rate DESC;
      `;

      const results = await db.execute(query);
      return extractRows(results).map((row) => ({
        operatorName: row.operator_name,
        sessionsCount: row.sessions_count || 0,
        totalScans: row.total_scans || 0,
        passRate: parseFloat(row.pass_rate || "0"),
        failRate: 100 - parseFloat(row.pass_rate || "0"),
        feedersPerMinute: parseFloat(row.feeders_per_minute || "0"),
      }));
    } catch (error) {
      logger.error({ err: error }, "Operator Performance Report generation failed");
      return [];
    }
  }

  /**
   * 4. Operator Comparison Report
   */
  static async generateOperatorComparisonReport(filters: ReportFilters): Promise<OperatorComparisonData> {
    try {
      const operatorData = await this.generateOperatorReport(filters);

      return {
        operators: operatorData.map((op) => ({
          operatorName: op.operatorName,
          accuracy: op.passRate,
          speed: op.feedersPerMinute,
          errors: 100 - op.passRate,
        })),
      };
    } catch (error) {
      logger.error({ err: error }, "Operator Comparison Report generation failed");
      return { operators: [] };
    }
  }

  /**
   * 5. Feeder Performance Report
   */
  static async generateFeederReport(filters: ReportFilters): Promise<FeederPerformanceData[]> {
    try {
      FilterService.validateFilters(filters);
      const dateFilter = filters.dateFilter || "custom";
      const { startDate, endDate } = FilterService.buildDateQuery(
        dateFilter as any,
        filters.startDate && filters.endDate
          ? { startDate: filters.startDate, endDate: filters.endDate }
          : undefined
      );

      const query = sql`
        SELECT 
          sr.feeder_number,
          COUNT(*) as usage_count,
          COUNT(CASE WHEN sr.validation_result NOT IN ('pass', 'pass_free_scan', 'alternate_pass') THEN 1 END) as fail_count,
          ROUND(100.0 * COUNT(CASE WHEN sr.validation_result NOT IN ('pass', 'pass_free_scan', 'alternate_pass') THEN 1 END) / NULLIF(COUNT(*), 0), 2) as error_rate,
          MAX(sr.scanned_at) as last_used_at
        FROM scan_records sr
        WHERE sr.scanned_at BETWEEN ${startDate} AND ${endDate}
        GROUP BY sr.feeder_number
        ORDER BY error_rate DESC, usage_count DESC
        LIMIT 50;
      `;

      const results = await db.execute(query);
      return extractRows(results).map((row) => ({
        feederNumber: row.feeder_number,
        usageCount: row.usage_count || 0,
        failCount: row.fail_count || 0,
        errorRate: parseFloat(row.error_rate || "0"),
        lastUsedAt: new Date(row.last_used_at),
      }));
    } catch (error) {
      logger.error({ err: error }, "Feeder Performance Report generation failed");
      return [];
    }
  }

  /**
   * 6. Feeder Reliability Report
   */
  static async generateFeederReliabilityReport(filters: ReportFilters): Promise<FeederReliabilityData[]> {
    try {
      FilterService.validateFilters(filters);
      const dateFilter = filters.dateFilter || "custom";
      const { startDate, endDate } = FilterService.buildDateQuery(
        dateFilter as any,
        filters.startDate && filters.endDate
          ? { startDate: filters.startDate, endDate: filters.endDate }
          : undefined
      );

      const query = sql`
        SELECT 
          sr.feeder_number,
          COUNT(*) as repeat_failures,
          COUNT(CASE WHEN sr.validation_result = 'mismatch' THEN 1 END) as warning_frequency,
          MAX(sr.scanned_at) as last_failed_at
        FROM scan_records sr
        WHERE sr.scanned_at BETWEEN ${startDate} AND ${endDate}
          AND sr.validation_result NOT IN ('pass', 'pass_free_scan', 'alternate_pass')
        GROUP BY sr.feeder_number
        HAVING COUNT(*) > 1
        ORDER BY repeat_failures DESC
        LIMIT 50;
      `;

      const results = await db.execute(query);
      return extractRows(results).map((row) => ({
        feederNumber: row.feeder_number,
        repeatFailures: row.repeat_failures || 0,
        warningFrequency: row.warning_frequency || 0,
        lastFailedAt: new Date(row.last_failed_at),
      }));
    } catch (error) {
      logger.error({ err: error }, "Feeder Reliability Report generation failed");
      return [];
    }
  }

  /**
   * 7. Alarm Report
   */
  static async generateAlarmReport(filters: ReportFilters): Promise<AlarmReportData[]> {
    try {
      FilterService.validateFilters(filters);
      const dateFilter = filters.dateFilter || "custom";
      const { startDate, endDate } = FilterService.buildDateQuery(
        dateFilter as any,
        filters.startDate && filters.endDate
          ? { startDate: filters.startDate, endDate: filters.endDate }
          : undefined
      );

      const query = sql`
        SELECT 
          sr.validation_result as alarm_type,
          sr.feeder_number,
          COUNT(*) as mismatch_count,
          MAX(sr.scanned_at) as last_occurred_at
        FROM scan_records sr
        WHERE sr.scanned_at BETWEEN ${startDate} AND ${endDate}
          AND sr.validation_result IN ('mismatch', 'feeder_not_found')
        GROUP BY sr.validation_result, sr.feeder_number
        ORDER BY mismatch_count DESC
        LIMIT 100;
      `;

      const results = await db.execute(query);
      return extractRows(results).map((row, idx) => ({
        alarmType:
          row.alarm_type === "mismatch"
            ? "high"
            : row.alarm_type === "feeder_not_found"
              ? "medium"
              : "low",
        feederNumber: row.feeder_number,
        mismatchCount: row.mismatch_count || 0,
        lastOccurredAt: new Date(row.last_occurred_at),
        severity: Math.min(10, Math.ceil((row.mismatch_count || 0) / 10)),
      }));
    } catch (error) {
      logger.error({ err: error }, "Alarm Report generation failed");
      return [];
    }
  }

  /**
   * 8. Error Analysis Report
   */
  static async generateErrorAnalysisReport(filters: ReportFilters): Promise<ErrorAnalysisData[]> {
    try {
      FilterService.validateFilters(filters);
      const dateFilter = filters.dateFilter || "custom";
      const { startDate, endDate } = FilterService.buildDateQuery(
        dateFilter as any,
        filters.startDate && filters.endDate
          ? { startDate: filters.startDate, endDate: filters.endDate }
          : undefined
      );

      const query = sql`
        SELECT 
          sr.feeder_number as identifier,
          COUNT(*) as fail_count,
          ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM scan_records WHERE scanned_at BETWEEN ${startDate} AND ${endDate}), 2) as error_rate
        FROM scan_records sr
        WHERE sr.scanned_at BETWEEN ${startDate} AND ${endDate}
          AND sr.validation_result NOT IN ('pass', 'pass_free_scan', 'alternate_pass')
        GROUP BY sr.feeder_number
        ORDER BY fail_count DESC
        LIMIT 10;
      `;

      const results = await db.execute(query);
      return extractRows(results).map((row) => ({
        type: "feeder" as const,
        identifier: row.identifier,
        failCount: row.fail_count || 0,
        errorRate: parseFloat(row.error_rate || "0"),
      }));
    } catch (error) {
      logger.error({ err: error }, "Error Analysis Report generation failed");
      return [];
    }
  }

  /**
   * 9. Component Usage Report
   */
  static async generateComponentReport(filters: ReportFilters): Promise<ComponentUsageData[]> {
    try {
      FilterService.validateFilters(filters);
      const dateFilter = filters.dateFilter || "custom";
      const { startDate, endDate } = FilterService.buildDateQuery(
        dateFilter as any,
        filters.startDate && filters.endDate
          ? { startDate: filters.startDate, endDate: filters.endDate }
          : undefined
      );

      const query = sql`
        SELECT 
          sr.scanned_mpn as mpn,
          COUNT(*) as usage_count,
          COUNT(CASE WHEN sr.validation_result NOT IN ('pass', 'pass_free_scan', 'alternate_pass') THEN 1 END) as fail_count
        FROM scan_records sr
        WHERE sr.scanned_at BETWEEN ${startDate} AND ${endDate}
          AND sr.scanned_mpn IS NOT NULL
        GROUP BY sr.scanned_mpn
        ORDER BY usage_count DESC
        LIMIT 100;
      `;

      const results = await db.execute(query);
      return extractRows(results).map((row) => ({
        mpn: row.mpn,
        usageCount: row.usage_count || 0,
        failCount: row.fail_count || 0,
        bomUsageCount: 0,
      }));
    } catch (error) {
      logger.error({ err: error }, "Component Usage Report generation failed");
      return [];
    }
  }

  /**
   * 10. Lot Traceability Report
   */
  static async generateLotTraceabilityReport(filters: ReportFilters): Promise<LotTraceabilityData[]> {
    try {
      FilterService.validateFilters(filters);
      const dateFilter = filters.dateFilter || "custom";
      const { startDate, endDate } = FilterService.buildDateQuery(
        dateFilter as any,
        filters.startDate && filters.endDate
          ? { startDate: filters.startDate, endDate: filters.endDate }
          : undefined
      );

      const query = sql`
        SELECT 
          sr.lot_number,
          sr.date_code,
          COUNT(*) as usage_count,
          COUNT(CASE WHEN sr.validation_result NOT IN ('pass', 'pass_free_scan', 'alternate_pass') THEN 1 END) as fail_count,
          ROUND(100.0 * COUNT(CASE WHEN sr.validation_result NOT IN ('pass', 'pass_free_scan', 'alternate_pass') THEN 1 END) / NULLIF(COUNT(*), 0), 2) as fail_rate,
          ARRAY_AGG(DISTINCT sr.feeder_number) as affected_feeders
        FROM scan_records sr
        WHERE sr.scanned_at BETWEEN ${startDate} AND ${endDate}
          AND sr.lot_number IS NOT NULL
        GROUP BY sr.lot_number, sr.date_code
        ORDER BY fail_count DESC
        LIMIT 100;
      `;

      const results = await db.execute(query);
      return extractRows(results).map((row) => ({
        lotNumber: row.lot_number,
        dateCode: row.date_code,
        usageCount: row.usage_count || 0,
        failCount: row.fail_count || 0,
        failRate: parseFloat(row.fail_rate || "0"),
        affectedFeeders: row.affected_feeders || [],
      }));
    } catch (error) {
      logger.error({ err: error }, "Lot Traceability Report generation failed");
      return [];
    }
  }

  /**
   * 11. Trend Report
   */
  static async generateTrendReport(filters: ReportFilters): Promise<TrendReportData[]> {
    try {
      FilterService.validateFilters(filters);
      const dateFilter = filters.dateFilter || "custom";
      const { startDate, endDate } = FilterService.buildDateQuery(
        dateFilter as any,
        filters.startDate && filters.endDate
          ? { startDate: filters.startDate, endDate: filters.endDate }
          : undefined
      );

      const query = sql`
        SELECT 
          DATE(sr.scanned_at) as date,
          COUNT(DISTINCT s.id) as sessions_count,
          COUNT(sr.id) as total_scans,
          COUNT(CASE WHEN sr.validation_result IN ('pass', 'pass_free_scan', 'alternate_pass') THEN 1 END) as pass_count,
          COUNT(CASE WHEN sr.validation_result NOT IN ('pass', 'pass_free_scan', 'alternate_pass') THEN 1 END) as fail_count,
          ROUND(100.0 * COUNT(CASE WHEN sr.validation_result IN ('pass', 'pass_free_scan', 'alternate_pass') THEN 1 END) / NULLIF(COUNT(*), 0), 2) as pass_rate,
          ROUND(AVG(EXTRACT(EPOCH FROM (s.end_time - s.start_time))), 2) as avg_cycle_time
        FROM scan_records sr
        JOIN sessions s ON sr.session_id = s.id
        WHERE sr.scanned_at BETWEEN ${startDate} AND ${endDate}
        GROUP BY DATE(sr.scanned_at)
        ORDER BY date DESC;
      `;

      const results = await db.execute(query);
      return extractRows(results).map((row) => ({
        date: row.date || new Date().toISOString(),
        sessionsCount: row.sessions_count || 0,
        totalScans: row.total_scans || 0,
        passCount: row.pass_count || 0,
        failCount: row.fail_count || 0,
        passRate: parseFloat(row.pass_rate || "0"),
        avgCycleTime: parseFloat(row.avg_cycle_time || "0"),
      }));
    } catch (error) {
      logger.error({ err: error }, "Trend Report generation failed");
      return [];
    }
  }
}
