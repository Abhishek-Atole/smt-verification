import { db } from "@workspace/db";
import { FilterService } from "./filter-service";
import { sql } from "drizzle-orm";
/**
 * Helper to extract rows from db.execute() result
 */
function extractRows(result) {
    if (Array.isArray(result))
        return result;
    if (result && Array.isArray(result.rows))
        return result.rows;
    return [];
}
/**
 * ReportService - Generates all 10 priority reports with SQL queries
 */
export class ReportService {
    /**
     * 1. FPY (First Pass Yield) Report
     * Formula: PASS_COUNT / TOTAL_FEEDERS * 100
     */
    static async generateFPYReport(filters) {
        try {
            FilterService.validateFilters(filters);
            const dateFilter = filters.dateFilter || "custom";
            const { startDate, endDate } = FilterService.buildDateQuery(dateFilter, filters.startDate && filters.endDate
                ? { startDate: filters.startDate, endDate: filters.endDate }
                : undefined);
            const query = sql `
        SELECT 
          DATE(sr.scanned_at) as date,
          COUNT(*) as total_feeders,
          COUNT(CASE WHEN sr.validation_result = 'pass' OR sr.validation_result = 'pass_free_scan' OR sr.validation_result = 'alternate_pass' THEN 1 END) as pass_feeders,
          COUNT(CASE WHEN sr.validation_result NOT IN ('pass', 'pass_free_scan', 'alternate_pass') THEN 1 END) as fail_feeders,
          ROUND(100.0 * COUNT(CASE WHEN sr.validation_result = 'pass' OR sr.validation_result = 'pass_free_scan' OR sr.validation_result = 'alternate_pass' THEN 1 END) / COUNT(*), 2) as fpy
        FROM scan_records sr
        JOIN sessions s ON sr.session_id = s.id
        WHERE sr.scanned_at BETWEEN ${startDate} AND ${endDate}
          ${filters.lineId ? sql `AND s.supervisor_name = ${filters.lineId}` : sql ``}
          ${filters.pcbId ? sql `AND s.panel_name = ${filters.pcbId}` : sql ``}
          ${filters.operatorId ? sql `AND s.operator_name = ${filters.operatorId}` : sql ``}
          ${filters.shiftId ? sql `AND s.shift_name = ${filters.shiftId}` : sql ``}
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
        }
        catch (error) {
            console.error("FPY Report generation failed:", error);
            return [];
        }
    }
    /**
     * 2. OEE (Overall Equipment Effectiveness) Report
     * Formula: OEE = Availability × Efficiency × Quality
     */
    static async generateOEEReport(filters) {
        try {
            FilterService.validateFilters(filters);
            const dateFilter = filters.dateFilter || "custom";
            const { startDate, endDate } = FilterService.buildDateQuery(dateFilter, filters.startDate && filters.endDate
                ? { startDate: filters.startDate, endDate: filters.endDate }
                : undefined);
            const query = sql `
        SELECT 
          s.id as session_id,
          s.operator_name,
          ROUND(EXTRACT(EPOCH FROM (s.end_time - s.start_time))::numeric / 3600, 2) as duration_hours,
          ROUND(100.0 * COUNT(CASE WHEN sr.validation_result IN ('pass', 'pass_free_scan', 'alternate_pass') THEN 1 END) / NULLIF(COUNT(*), 0), 2) as quality,
          ROUND(COUNT(sr.id)::numeric / NULLIF(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60, 0), 2) as efficiency,
          100.0 as availability
        FROM scan_records sr
        JOIN sessions s ON sr.session_id = s.id
        WHERE sr.scanned_at BETWEEN ${startDate} AND ${endDate}
          AND s.end_time IS NOT NULL
          ${filters.operatorId ? sql `AND s.operator_name = ${filters.operatorId}` : sql ``}
        GROUP BY s.id, s.operator_name
        ORDER BY session_id DESC;
      `;
            const results = await db.execute(query);
            return extractRows(results).map((row) => {
                const quality = parseFloat(row.quality || "0") / 100;
                const efficiency = Math.min(1, parseFloat(row.efficiency || "0") / 60); // Normalize
                const availability = parseFloat(row.availability || "100") / 100;
                const oee = quality * efficiency * availability * 100;
                return {
                    sessionId: row.session_id,
                    operatorName: row.operator_name,
                    durationHours: parseFloat(row.duration_hours || "0"),
                    quality: parseFloat(row.quality || "0"),
                    efficiency: parseFloat(row.efficiency || "0"),
                    availability,
                    oee: Math.min(100, oee),
                };
            });
        }
        catch (error) {
            console.error("OEE Report generation failed:", error);
            return [];
        }
    }
    /**
     * 3. Operator Performance Report
     */
    static async generateOperatorReport(filters) {
        try {
            FilterService.validateFilters(filters);
            const dateFilter = filters.dateFilter || "custom";
            const { startDate, endDate } = FilterService.buildDateQuery(dateFilter, filters.startDate && filters.endDate
                ? { startDate: filters.startDate, endDate: filters.endDate }
                : undefined);
            const query = sql `
        SELECT 
          s.operator_name,
          COUNT(DISTINCT s.id) as sessions_count,
          COUNT(sr.id) as total_scans,
          ROUND(100.0 * COUNT(CASE WHEN sr.validation_result IN ('pass', 'pass_free_scan', 'alternate_pass') THEN 1 END) / NULLIF(COUNT(*), 0), 2) as pass_rate,
          ROUND(COUNT(sr.id)::numeric / NULLIF(SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60), 0), 2) as feeders_per_minute
        FROM scan_records sr
        JOIN sessions s ON sr.session_id = s.id
        WHERE sr.scanned_at BETWEEN ${startDate} AND ${endDate}
          ${filters.lineId ? sql `AND s.supervisor_name = ${filters.lineId}` : sql ``}
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
        }
        catch (error) {
            console.error("Operator Performance Report generation failed:", error);
            return [];
        }
    }
    /**
     * 4. Operator Comparison Report
     */
    static async generateOperatorComparisonReport(filters) {
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
        }
        catch (error) {
            console.error("Operator Comparison Report generation failed:", error);
            return { operators: [] };
        }
    }
    /**
     * 5. Feeder Performance Report
     */
    static async generateFeederReport(filters) {
        try {
            FilterService.validateFilters(filters);
            const dateFilter = filters.dateFilter || "custom";
            const { startDate, endDate } = FilterService.buildDateQuery(dateFilter, filters.startDate && filters.endDate
                ? { startDate: filters.startDate, endDate: filters.endDate }
                : undefined);
            const query = sql `
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
        }
        catch (error) {
            console.error("Feeder Performance Report generation failed:", error);
            return [];
        }
    }
    /**
     * 6. Feeder Reliability Report
     */
    static async generateFeederReliabilityReport(filters) {
        try {
            FilterService.validateFilters(filters);
            const dateFilter = filters.dateFilter || "custom";
            const { startDate, endDate } = FilterService.buildDateQuery(dateFilter, filters.startDate && filters.endDate
                ? { startDate: filters.startDate, endDate: filters.endDate }
                : undefined);
            const query = sql `
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
        }
        catch (error) {
            console.error("Feeder Reliability Report generation failed:", error);
            return [];
        }
    }
    /**
     * 7. Alarm Report
     */
    static async generateAlarmReport(filters) {
        try {
            FilterService.validateFilters(filters);
            const dateFilter = filters.dateFilter || "custom";
            const { startDate, endDate } = FilterService.buildDateQuery(dateFilter, filters.startDate && filters.endDate
                ? { startDate: filters.startDate, endDate: filters.endDate }
                : undefined);
            const query = sql `
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
                alarmType: row.alarm_type === "mismatch"
                    ? "high"
                    : row.alarm_type === "feeder_not_found"
                        ? "medium"
                        : "low",
                feederNumber: row.feeder_number,
                mismatchCount: row.mismatch_count || 0,
                lastOccurredAt: new Date(row.last_occurred_at),
                severity: Math.min(10, Math.ceil((row.mismatch_count || 0) / 10)),
            }));
        }
        catch (error) {
            console.error("Alarm Report generation failed:", error);
            return [];
        }
    }
    /**
     * 8. Error Analysis Report
     */
    static async generateErrorAnalysisReport(filters) {
        try {
            FilterService.validateFilters(filters);
            const dateFilter = filters.dateFilter || "custom";
            const { startDate, endDate } = FilterService.buildDateQuery(dateFilter, filters.startDate && filters.endDate
                ? { startDate: filters.startDate, endDate: filters.endDate }
                : undefined);
            const query = sql `
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
                type: "feeder",
                identifier: row.identifier,
                failCount: row.fail_count || 0,
                errorRate: parseFloat(row.error_rate || "0"),
            }));
        }
        catch (error) {
            console.error("Error Analysis Report generation failed:", error);
            return [];
        }
    }
    /**
     * 9. Component Usage Report
     */
    static async generateComponentReport(filters) {
        try {
            FilterService.validateFilters(filters);
            const dateFilter = filters.dateFilter || "custom";
            const { startDate, endDate } = FilterService.buildDateQuery(dateFilter, filters.startDate && filters.endDate
                ? { startDate: filters.startDate, endDate: filters.endDate }
                : undefined);
            const query = sql `
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
        }
        catch (error) {
            console.error("Component Usage Report generation failed:", error);
            return [];
        }
    }
    /**
     * 10. Lot Traceability Report
     */
    static async generateLotTraceabilityReport(filters) {
        try {
            FilterService.validateFilters(filters);
            const dateFilter = filters.dateFilter || "custom";
            const { startDate, endDate } = FilterService.buildDateQuery(dateFilter, filters.startDate && filters.endDate
                ? { startDate: filters.startDate, endDate: filters.endDate }
                : undefined);
            const query = sql `
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
        }
        catch (error) {
            console.error("Lot Traceability Report generation failed:", error);
            return [];
        }
    }
    /**
     * 11. Trend Report
     */
    static async generateTrendReport(filters) {
        try {
            FilterService.validateFilters(filters);
            const dateFilter = filters.dateFilter || "custom";
            const { startDate, endDate } = FilterService.buildDateQuery(dateFilter, filters.startDate && filters.endDate
                ? { startDate: filters.startDate, endDate: filters.endDate }
                : undefined);
            const query = sql `
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
        }
        catch (error) {
            console.error("Trend Report generation failed:", error);
            return [];
        }
    }
}
