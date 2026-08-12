/**
 * FilterService - Builds SQL WHERE clauses and validates filters
 */
export class FilterService {
    /**
     * Convert date filter string to start/end dates
     */
    static buildDateQuery(filterType, customDates) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        switch (filterType) {
            case "today":
                return {
                    startDate: today,
                    endDate: tomorrow,
                };
            case "yesterday":
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                return {
                    startDate: yesterday,
                    endDate: today,
                };
            case "last7":
                const sevenDaysAgo = new Date(today);
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                return {
                    startDate: sevenDaysAgo,
                    endDate: tomorrow,
                };
            case "last30":
                const thirtyDaysAgo = new Date(today);
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                return {
                    startDate: thirtyDaysAgo,
                    endDate: tomorrow,
                };
            case "custom":
                if (!customDates) {
                    throw new Error("Custom date filter requires startDate and endDate");
                }
                const startDate = new Date(customDates.startDate);
                const endDate = new Date(customDates.endDate);
                // Validate dates are valid
                if (isNaN(startDate.getTime())) {
                    throw new Error("Invalid startDate format");
                }
                if (isNaN(endDate.getTime())) {
                    throw new Error("Invalid endDate format");
                }
                // Validate date range
                if (startDate > endDate) {
                    throw new Error("startDate cannot be after endDate");
                }
                return {
                    startDate,
                    endDate,
                };
            default:
                throw new Error(`Unknown date filter: ${filterType}`);
        }
    }
    /**
     * Build multi-filter WHERE clause
     */
    static buildMultiFilterClause(filters) {
        const clauses = [];
        if (filters.lineId) {
            clauses.push(`s.supervisor_name = '${this.escapeSql(filters.lineId)}'`);
        }
        if (filters.pcbId) {
            clauses.push(`s.panel_name = '${this.escapeSql(filters.pcbId)}'`);
        }
        if (filters.operatorId) {
            clauses.push(`s.operator_name = '${this.escapeSql(filters.operatorId)}'`);
        }
        if (filters.shiftId) {
            clauses.push(`s.shift_name = '${this.escapeSql(filters.shiftId)}'`);
        }
        return clauses.length > 0 ? "AND " + clauses.join(" AND ") : "";
    }
    /**
     * Escape SQL strings to prevent injection
     */
    static escapeSql(value) {
        return value.replace(/'/g, "''");
    }
    /**
     * Validate filter object
     */
    static validateFilters(filters) {
        // Check for ambiguous combinations
        if (filters.dateFilter && (filters.startDate || filters.endDate)) {
            throw new Error("Cannot use dateFilter with startDate/endDate; choose one");
        }
        // If startDate or endDate is provided, both must be provided
        if ((filters.startDate || filters.endDate)) {
            if (!filters.startDate || !filters.endDate) {
                throw new Error("Both startDate and endDate must be provided together");
            }
            const start = new Date(filters.startDate);
            const end = new Date(filters.endDate);
            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                throw new Error("Invalid date format");
            }
            if (start > end) {
                throw new Error("startDate cannot be after endDate");
            }
        }
        else if (!filters.dateFilter) {
            // Either provide startDate/endDate or dateFilter
            throw new Error("Either provide startDate/endDate or dateFilter");
        }
    }
}
